// ============================================================================
// routes/ad.js — Active Directory via PowerShell
// ► Si RSAT está instalado  → usa Import-Module ActiveDirectory (Get-ADUser etc.)
// ► Si NO está instalado     → usa ADSI (System.DirectoryServices) automáticamente
//   ADSI funciona en CUALQUIER máquina Windows unida al dominio, sin instalar nada.
// ============================================================================
const express   = require('express');
const router    = express.Router();
const { spawn } = require('child_process');

// ============================================================================
// CACHE EN MEMORIA
// ─ Los KPIs, stale-users y offline-computers se calculan una vez cada
//   CACHE_TTL ms ejecutando PS en background.  Las requests leen del cache
//   y responden en < 50 ms.  La búsqueda individual de usuario va siempre
//   directo al AD (es una sola cuenta → ~1-3 s, aceptable).
// ============================================================================
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos (ajusta entre 5-15)

const cache = {
    kpis:    { data: null, ts: 0 },
    stale:   { data: null, ts: 0 },
    offline: { data: null, ts: 0 },
    users:   { data: null, ts: 0 }, // lista ligera para autocomplete
};

let refreshRunning = false;

async function refreshCache() {
    if (refreshRunning) return;
    refreshRunning = true;
    console.log('[AD cache] Iniciando refresh...');
    try {
        const [kpis, stale, offline, users] = await Promise.all([
            fetchKPIs(),
            fetchStaleUsers(),
            fetchOfflineComputers(),
            fetchUsersForAutocomplete(),
        ]);
        cache.kpis    = { data: kpis,    ts: Date.now() };
        cache.stale   = { data: stale,   ts: Date.now() };
        cache.offline = { data: offline, ts: Date.now() };
        cache.users   = { data: users,   ts: Date.now() };
        console.log(`[AD cache] Refresh OK — ${new Date().toLocaleTimeString('es-PE')} — ${users.length} usuarios indexados`);
    } catch(e) {
        console.error('[AD cache] Error en refresh:', e.message);
    } finally {
        refreshRunning = false;
    }
}

// Arrancar cache al cargar el módulo (sin bloquear) + refrescar periódicamente
setTimeout(refreshCache, 3000);                    // 3 s después de arrancar Node
setInterval(refreshCache, CACHE_TTL);              // cada 10 min

// Helper: devuelve cache si es fresco, si no dispara refresh y devuelve lo que hay
function fromCache(key) {
    const entry = cache[key];
    const age   = Date.now() - entry.ts;
    if (age > CACHE_TTL && !refreshRunning) {
        refreshCache();                            // refresca en background
    }
    return entry.data;                             // puede ser null si aún no cargó
}

// ─── Helper: ejecutar PowerShell ─────────────────────────────────────────────
function runPS(script) {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-OutputFormat', 'Text',
            '-Command', script
        ]);
        let out = '', err = '';
        ps.stdout.on('data', d => out += d.toString('utf8'));
        ps.stderr.on('data', d => err += d.toString('utf8'));
        ps.on('close', code => {
            const raw = out.trim();
            if (!raw && code !== 0) return reject(new Error(err.trim() || `PS exit ${code}`));
            try   { resolve(JSON.parse(raw)); }
            catch { resolve(raw); }
        });
    });
}

function safe(str) {
    return (str || '').replace(/[^a-zA-Z0-9._\-]/g, '').slice(0, 64);
}

// ─── Bootstrap compartido — detecta módulo y define funciones helper ─────────
const PS_BOOTSTRAP = String.raw`
$ErrorActionPreference = 'Stop'
$useModule = $false
try { Import-Module ActiveDirectory -ErrorAction Stop; $useModule = $true } catch {}

function ConvertFrom-FileTime([long]$ft) {
    if ($ft -le 0 -or $ft -eq 9223372036854775807) { return $null }
    return [datetime]::FromFileTime($ft)
}

$MACHINE_OU      = "OU=Asignado, OU=Equipos, OU=Workplace, DC=gp, DC=inet"
$MACHINE_OU_PROV = "OU=Proveedores-OTF, OU=GP-OTF, DC=gp, DC=inet"
$USER_OU         = "OU=Usuarios-Integratel, OU=Integratel, OU=Usuarios-IntTel, OU=GP-IntTel, DC=gp, DC=inet"
$USER_OU_PROV    = "OU=Proveedores-OTF, OU=GP-OTF, DC=gp, DC=inet"

function Get-DomainBase {
    $root = New-Object System.DirectoryServices.DirectoryEntry("LDAP://RootDSE")
    return New-Object System.DirectoryServices.DirectoryEntry("LDAP://$($root.defaultNamingContext)")
}
function Get-MachineBase      { New-Object System.DirectoryServices.DirectoryEntry("LDAP://$MACHINE_OU") }
function Get-MachinePROVBase  { New-Object System.DirectoryServices.DirectoryEntry("LDAP://$MACHINE_OU_PROV") }
function Get-UserBase         { New-Object System.DirectoryServices.DirectoryEntry("LDAP://$USER_OU") }
function Get-UserPROVBase     { New-Object System.DirectoryServices.DirectoryEntry("LDAP://$USER_OU_PROV") }

function New-SearcherFrom([System.DirectoryServices.DirectoryEntry]$base, [string]$filter, [string[]]$props) {
    $s = New-Object System.DirectoryServices.DirectorySearcher($base)
    $s.Filter   = $filter
    $s.PageSize = 1000
    foreach ($p in $props) { [void]$s.PropertiesToLoad.Add($p) }
    return $s
}

# Busca en varias bases y combina resultados (deduplicado por samaccountname/cn)
function Search-MultiBase([System.DirectoryServices.DirectoryEntry[]]$bases, [string]$filter, [string[]]$props) {
    $seen    = @{}
    $results = [System.Collections.Generic.List[object]]::new()
    foreach ($base in $bases) {
        try {
            $s = New-SearcherFrom $base $filter $props
            foreach ($r in $s.FindAll()) {
                $key = if ($r.Properties["samaccountname"].Count -gt 0) { "$($r.Properties['samaccountname'][0])" }
                       elseif ($r.Properties["cn"].Count -gt 0)          { "$($r.Properties['cn'][0])" }
                       else { $r.Path }
                if (-not $seen.ContainsKey($key)) {
                    $seen[$key] = $true
                    $results.Add($r)
                }
            }
        } catch { Write-Warning "SearchBase error: $_" }
    }
    return $results
}

function ConvertTo-UserObj($p) {
    $uac     = if ($p["useraccountcontrol"].Count -gt 0) { [int]$p["useraccountcontrol"][0] } else { 0 }
    $locked  = (ConvertFrom-FileTime $(if($p["lockouttime"].Count -gt 0){$p["lockouttime"][0]}else{0})) -ne $null
    $pwdSet  = ConvertFrom-FileTime $(if($p["pwdlastset"].Count -gt 0){$p["pwdlastset"][0]}else{0})
    $accExp  = ConvertFrom-FileTime $(if($p["accountexpires"].Count -gt 0){$p["accountexpires"][0]}else{0})
    $ll      = ConvertFrom-FileTime $(if($p["lastlogontimestamp"].Count -gt 0){$p["lastlogontimestamp"][0]}else{0})
    $pwdExpDT= $null
    try {
        $pe = $p["msds-userpasswordexpirytimecomputed"]
        if ($pe.Count -gt 0) { $pwdExpDT = ConvertFrom-FileTime $pe[0] }
    } catch {}
    $groups = @($p["memberof"] | ForEach-Object { ($_ -split ',')[0] -replace '^CN=','' })
    $dn     = if($p['distinguishedname'].Count -gt 0){"$($p['distinguishedname'][0])"}else{""}
    # Detectar si es proveedor por OU
    $isProv = $dn -match 'Proveedores-OTF'
    [PSCustomObject]@{
        SamAccountName       = "$($p['samaccountname'][0])"
        DisplayName          = if($p['displayname'].Count -gt 0){"$($p['displayname'][0])"}else{""}
        EmailAddress         = if($p['mail'].Count -gt 0){"$($p['mail'][0])"}else{""}
        Department           = if($p['department'].Count -gt 0){"$($p['department'][0])"}else{""}
        Title                = if($p['title'].Count -gt 0){"$($p['title'][0])"}else{""}
        Description          = if($p['description'].Count -gt 0){"$($p['description'][0])"}else{""}
        WebPage              = if($p['wwwhomepage'].Count -gt 0){"$($p['wwwhomepage'][0])"}else{""}
        OfficePhone          = if($p['telephonenumber'].Count -gt 0){"$($p['telephonenumber'][0])"}else{""}
        Office               = if($p['physicaldeliveryofficename'].Count -gt 0){"$($p['physicaldeliveryofficename'][0])"}else{""}
        Enabled              = -not [bool]($uac -band 0x2)
        LockedOut            = $locked
        PasswordExpired      = [bool]($uac -band 0x800000)
        AccountExpirationDate= $accExp
        LastLogonDate        = $ll
        PasswordLastSet      = $pwdSet
        PasswordExpires      = $pwdExpDT
        Created              = if($p['whencreated'].Count -gt 0){$p['whencreated'][0]}else{$null}
        DistinguishedName    = $dn
        MemberOf             = $groups
        IsProveedor          = $isProv
    }
}

# Propiedades ADSI para usuarios (incluye wwwhomepage)
$USER_PROPS = @("samaccountname","displayname","mail","department","title","description",
                "wwwhomepage","useraccountcontrol","lockouttime","pwdlastset","accountexpires",
                "lastlogontimestamp","whencreated","memberof","distinguishedname",
                "telephonenumber","physicaldeliveryofficename","msds-userpasswordexpirytimecomputed")

# Propiedades módulo AD para usuarios
$USER_MODULE_PROPS = @("Enabled","LockedOut","PasswordExpired","AccountExpirationDate","LastLogonDate",
                       "Department","Title","EmailAddress","Description","wWWHomePage","PasswordLastSet",
                       "Created","MemberOf","DistinguishedName","OfficePhone","Office","PasswordExpires",
                       "SamAccountName","DisplayName")

function Get-ADUsersAll {
    if ($useModule) {
        $all  = [System.Collections.Generic.List[object]]::new()
        $seen = @{}
        foreach ($ou in @($USER_OU, $USER_OU_PROV)) {
            try {
                Get-ADUser -Filter * -SearchBase $ou -Properties $USER_MODULE_PROPS | ForEach-Object {
                    if (-not $seen.ContainsKey($_.SamAccountName)) {
                        $seen[$_.SamAccountName] = $true
                        $_ | Add-Member -NotePropertyName WebPage     -NotePropertyValue $_.wWWHomePage -Force
                        $_ | Add-Member -NotePropertyName IsProveedor -NotePropertyValue ($_.DistinguishedName -match 'Proveedores-OTF') -Force
                        $all.Add($_)
                    }
                }
            } catch { Write-Warning "Get-ADUser OU error ($ou): $_" }
        }
        return $all
    }
    $filter = "(&(objectCategory=person)(objectClass=user))"
    $bases  = @(Get-UserBase; Get-UserPROVBase)
    Search-MultiBase $bases $filter $USER_PROPS | ForEach-Object { ConvertTo-UserObj $_.Properties }
}

function Get-ADComputersAll {
    $compProps = @("cn","operatingsystem","lastlogontimestamp","useraccountcontrol","description")
    if ($useModule) {
        $all  = [System.Collections.Generic.List[object]]::new()
        $seen = @{}
        foreach ($ou in @($MACHINE_OU, $MACHINE_OU_PROV)) {
            try {
                Get-ADComputer -Filter * -SearchBase $ou -Properties LastLogonDate,OperatingSystem,Enabled,Description | ForEach-Object {
                    if (-not $seen.ContainsKey($_.Name)) {
                        $seen[$_.Name] = $true
                        $all.Add($_)
                    }
                }
            } catch { Write-Warning "Get-ADComputer OU error ($ou): $_" }
        }
        return $all
    }
    $bases = @(Get-MachineBase; Get-MachinePROVBase)
    Search-MultiBase $bases "(objectCategory=computer)" $compProps | ForEach-Object {
        $p   = $_.Properties
        $uac = if($p["useraccountcontrol"].Count -gt 0){[int]$p["useraccountcontrol"][0]}else{0}
        $ll  = ConvertFrom-FileTime $(if($p["lastlogontimestamp"].Count -gt 0){$p["lastlogontimestamp"][0]}else{0})
        [PSCustomObject]@{
            Name            = if($p["cn"].Count -gt 0){"$($p['cn'][0])"}else{""}
            OperatingSystem = if($p["operatingsystem"].Count -gt 0){"$($p['operatingsystem'][0])"}else{""}
            Description     = if($p["description"].Count -gt 0){"$($p['description'][0])"}else{""}
            LastLogonDate   = $ll
            Enabled         = -not [bool]($uac -band 0x2)
        }
    }
}

function Get-ADUserOne([string]$account) {
    if ($useModule) {
        foreach ($ou in @($USER_OU, $USER_OU_PROV)) {
            try {
                $u = Get-ADUser -Filter { SamAccountName -eq $account } -SearchBase $ou -Properties * | Select-Object -First 1
                if ($u) {
                    $u | Add-Member -NotePropertyName WebPage     -NotePropertyValue $u.wWWHomePage -Force
                    $u | Add-Member -NotePropertyName IsProveedor -NotePropertyValue ($u.DistinguishedName -match 'Proveedores-OTF') -Force
                    return $u
                }
            } catch {}
        }
        return $null
    }
    $bases = @(Get-UserBase; Get-UserPROVBase)
    $r = $null
    foreach ($base in $bases) {
        try {
            $s = New-SearcherFrom $base "(&(objectCategory=person)(objectClass=user)(samaccountname=$account))" $USER_PROPS
            $r = $s.FindOne()
            if ($r) { break }
        } catch {}
    }
    if (-not $r) { return $null }
    return ConvertTo-UserObj $r.Properties
}
`;

// ============================================================================
// Funciones de fetch puras (usadas por el cache y como fallback directo)
// ============================================================================

// Lista ligera de todos los usuarios — solo los campos necesarios para autocomplete
async function fetchUsersForAutocomplete() {
    const script = PS_BOOTSTRAP + `
$list = @(Get-ADUsersAll) | ForEach-Object {
    [ordered]@{
        account = $_.SamAccountName
        name    = $_.DisplayName
        dept    = $_.Department
        enabled = [bool]$_.Enabled
    }
}
@{ users = @($list) } | ConvertTo-Json -Depth 2 -Compress
`;
    const data = await runPS(script);
    return data.users || [];
}

async function fetchKPIs() {
    const script = PS_BOOTSTRAP + `
$now   = Get-Date
$users = @(Get-ADUsersAll)
$comps = @(Get-ADComputersAll)
[ordered]@{
    total      = $users.Count
    active     = @($users | Where-Object { $_.Enabled }).Count
    inactive   = @($users | Where-Object { -not $_.Enabled }).Count
    expired    = @($users | Where-Object { $_.AccountExpirationDate -and $_.AccountExpirationDate -lt $now }).Count
    locked     = @($users | Where-Object { $_.LockedOut }).Count
    pwdExpired = @($users | Where-Object { $_.Enabled -and $_.PasswordExpired }).Count
    stale90    = @($users | Where-Object {
        $_.Enabled -and ($_.LastLogonDate -eq $null -or ($now - $_.LastLogonDate).Days -gt 90)
    }).Count
    computers  = $comps.Count
    compOff30  = @($comps | Where-Object {
        $_.LastLogonDate -eq $null -or ($now - $_.LastLogonDate).Days -gt 30
    }).Count
} | ConvertTo-Json -Compress
`;
    return runPS(script);
}

async function fetchStaleUsers() {
    const script = PS_BOOTSTRAP + `
$now    = Get-Date
$cutoff = $now.AddDays(-90)
$list   = @(Get-ADUsersAll) |
    Where-Object { $_.Enabled -and ($_.LastLogonDate -eq $null -or $_.LastLogonDate -lt $cutoff) } |
    Sort-Object LastLogonDate | Select-Object -First 50 |
    ForEach-Object {
        [ordered]@{
            account   = $_.SamAccountName
            name      = $_.DisplayName
            email     = $_.EmailAddress
            department= $_.Department
            title     = $_.Title
            lastLogon = if($_.LastLogonDate){$_.LastLogonDate.ToString('o')}else{$null}
            days      = if($_.LastLogonDate){[int]($now-$_.LastLogonDate).TotalDays}else{9999}
        }
    }
@{ users = @($list) } | ConvertTo-Json -Depth 3 -Compress
`;
    const data = await runPS(script);
    return data.users || [];
}

async function fetchOfflineComputers() {
    const script = PS_BOOTSTRAP + `
$now    = Get-Date
$cutoff = $now.AddDays(-30)
$list   = @(Get-ADComputersAll) |
    Where-Object { $_.Enabled -and ($_.LastLogonDate -eq $null -or $_.LastLogonDate -lt $cutoff) } |
    Sort-Object LastLogonDate | Select-Object -First 50 |
    ForEach-Object {
        [ordered]@{
            name     = $_.Name
            os       = $_.OperatingSystem
            desc     = $_.Description
            lastLogon= if($_.LastLogonDate){$_.LastLogonDate.ToString('o')}else{$null}
            days     = if($_.LastLogonDate){[int]($now-$_.LastLogonDate).TotalDays}else{9999}
        }
    }
@{ computers = @($list) } | ConvertTo-Json -Depth 3 -Compress
`;
    const data = await runPS(script);
    return data.computers || [];
}

// ============================================================================
// GET /api/ad/kpis — lee del cache
// ============================================================================
router.get('/kpis', async (req, res) => {
    const data = fromCache('kpis');
    if (data) return res.json({ success: true, data, cached: true });
    // Cache aún vacío (primer arranque) → esperar resultado directo
    try {
        const fresh = await fetchKPIs();
        cache.kpis = { data: fresh, ts: Date.now() };
        res.json({ success: true, data: fresh, cached: false });
    } catch(e) {
        console.error('[AD kpis]', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// GET /api/ad/user?account=jperez
// ============================================================================
router.get('/user', async (req, res) => {
    const account = safe(req.query.account);
    if (!account) return res.status(400).json({ success: false, error: 'Cuenta requerida' });

    const script = PS_BOOTSTRAP + `
$now = Get-Date
$u   = Get-ADUserOne '${account}'
if (-not $u) {
    [ordered]@{ found=$false; error='Cuenta no encontrada en Active Directory' } | ConvertTo-Json -Compress
    return
}

$comp = $null
if ($useModule) {
    foreach ($ou in @($MACHINE_OU, $MACHINE_OU_PROV)) {
        try { $comp = Get-ADComputer -Filter { ManagedBy -eq $u.DistinguishedName } -SearchBase $ou -Properties LastLogonDate,OperatingSystem | Select-Object -First 1 } catch {}
        if ($comp) { break }
    }
    if (-not $comp) {
        foreach ($ou in @($MACHINE_OU, $MACHINE_OU_PROV)) {
            try { $comp = Get-ADComputer -Filter * -SearchBase $ou -Properties LastLogonDate,OperatingSystem,Description | Where-Object { $_.Description -like '*${account}*' } | Select-Object -First 1 } catch {}
            if ($comp) { break }
        }
    }
}

$daysLogin = if ($u.LastLogonDate) { [int]($now - $u.LastLogonDate).TotalDays } else { $null }
$pwdDays   = if ($u.PasswordExpires) { [int]($u.PasswordExpires - $now).TotalDays } else { $null }
$accDays   = if ($u.AccountExpirationDate) { [int]($u.AccountExpirationDate - $now).TotalDays } else { $null }

$compObj = if ($comp) {[ordered]@{
    name=$comp.Name; os=$comp.OperatingSystem
    lastLogon=if($comp.LastLogonDate){$comp.LastLogonDate.ToString('o')}else{$null}
}} else { $null }

[ordered]@{
    found          = $true
    samAccount     = $u.SamAccountName
    displayName    = $u.DisplayName
    email          = $u.EmailAddress
    department     = $u.Department
    title          = $u.Title
    phone          = $u.OfficePhone
    office         = $u.Office
    description    = $u.Description
    webPage        = if($u.WebPage){$u.WebPage}else{""}
    enabled        = [bool]$u.Enabled
    lockedOut      = [bool]$u.LockedOut
    passwordExpired= [bool]$u.PasswordExpired
    isProveedor    = [bool]$u.IsProveedor
    lastLogonDate  = if($u.LastLogonDate){$u.LastLogonDate.ToString('o')}else{$null}
    daysNoLogin    = $daysLogin
    accountExpDate = if($u.AccountExpirationDate){$u.AccountExpirationDate.ToString('o')}else{$null}
    accountExpDays = $accDays
    pwdExpDays     = $pwdDays
    pwdLastSet     = if($u.PasswordLastSet){$u.PasswordLastSet.ToString('o')}else{$null}
    created        = if($u.Created){$u.Created.ToString('o')}else{$null}
    ou             = ($u.DistinguishedName -replace '^CN=[^,]+,','')
    groups         = @($u.MemberOf)
    computer       = $compObj
} | ConvertTo-Json -Depth 4 -Compress
`;
    try {
        const data = await runPS(script);
        res.json({ success: true, data });
    } catch(e) {
        console.error('[AD user]', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// GET /api/ad/stale-users — lee del cache
// ============================================================================
router.get('/stale-users', async (req, res) => {
    const data = fromCache('stale');
    if (data) return res.json({ success: true, data, cached: true });
    try {
        const fresh = await fetchStaleUsers();
        cache.stale = { data: fresh, ts: Date.now() };
        res.json({ success: true, data: fresh, cached: false });
    } catch(e) {
        console.error('[AD stale]', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// GET /api/ad/offline-computers — lee del cache
// ============================================================================
router.get('/offline-computers', async (req, res) => {
    const data = fromCache('offline');
    if (data) return res.json({ success: true, data, cached: true });
    try {
        const fresh = await fetchOfflineComputers();
        cache.offline = { data: fresh, ts: Date.now() };
        res.json({ success: true, data: fresh, cached: false });
    } catch(e) {
        console.error('[AD offline]', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// POST /api/ad/unlock
// ============================================================================
router.post('/unlock', async (req, res) => {
    const account = safe(req.body?.account);
    if (!account) return res.status(400).json({ success: false, error: 'Cuenta requerida' });
    const script = `
$ErrorActionPreference='Stop'
$useModule=$false
try{Import-Module ActiveDirectory -ErrorAction Stop;$useModule=$true}catch{}
if($useModule){
    Unlock-ADAccount -Identity '${account}'
}else{
    $s=New-Object System.DirectoryServices.DirectorySearcher(
        (New-Object System.DirectoryServices.DirectoryEntry("LDAP://$(([ADSI]'LDAP://RootDSE').defaultNamingContext)")))
    $s.Filter="(&(objectCategory=person)(objectClass=user)(samaccountname=${account}))"
    $r=$s.FindOne()
    if(-not $r){throw "Cuenta no encontrada"}
    $u=$r.GetDirectoryEntry()
    $u.psbase.InvokeSet("lockoutTime",@(0))
    $u.SetInfo()
}
Write-Output '{"ok":true}'
`;
    try {
        await runPS(script);
        res.json({ success: true, message: `Cuenta ${account} desbloqueada` });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// POST /api/ad/reset-password — poner contraseña temporal + forzar cambio al próximo login
// ============================================================================
router.post('/reset-password', async (req, res) => {
    const account  = safe(req.body?.account);
    const password = (req.body?.password || '').trim();

    if (!account)  return res.status(400).json({ success: false, error: 'Cuenta requerida' });
    if (!password) return res.status(400).json({ success: false, error: 'Contraseña requerida' });

    // Validación mínima: largo >= 8, al menos 1 mayúscula, 1 número, 1 especial
    const pwdOk = password.length >= 8
        && /[A-Z]/.test(password)
        && /[0-9]/.test(password)
        && /[^A-Za-z0-9]/.test(password);
    if (!pwdOk) return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener mínimo 8 caracteres, una mayúscula, un número y un carácter especial'
    });

    // Escapar comillas simples para PowerShell
    const pwdEscaped = password.replace(/'/g, "''");

    const script = `
$ErrorActionPreference='Stop'
$useModule=$false
try{Import-Module ActiveDirectory -ErrorAction Stop;$useModule=$true}catch{}
$newPwd = ConvertTo-SecureString '${pwdEscaped}' -AsPlainText -Force
if($useModule){
    Set-ADAccountPassword -Identity '${account}' -NewPassword $newPwd -Reset
    Set-ADUser           -Identity '${account}' -ChangePasswordAtLogon $true
}else{
    $s=New-Object System.DirectoryServices.DirectorySearcher(
        (New-Object System.DirectoryServices.DirectoryEntry("LDAP://$(([ADSI]'LDAP://RootDSE').defaultNamingContext)")))
    $s.Filter="(&(objectCategory=person)(objectClass=user)(samaccountname=${account}))"
    $r=$s.FindOne()
    if(-not $r){throw "Cuenta no encontrada"}
    $u=$r.GetDirectoryEntry()
    $u.psbase.Invoke("SetPassword","${pwdEscaped}")
    $u.psbase.InvokeSet("pwdLastSet",@(0))
    $u.SetInfo()
}
Write-Output '{"ok":true}'
`;
    try {
        await runPS(script);
        res.json({ success: true, message: `Contraseña restablecida para ${account}. El usuario deberá cambiarla al próximo login.` });
    } catch(e) {
        console.error('[AD reset-pwd]', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// GET /api/ad/search?q=jper — autocomplete desde cache (0 ms, sin AD)
// ============================================================================
router.get('/search', (req, res) => {
    const q = (req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ success: true, data: [] });

    const users = cache.users.data;
    if (!users) return res.json({ success: true, data: [], warming: true });

    const results = users
        .filter(u =>
            u.account?.toLowerCase().includes(q) ||
            u.name?.toLowerCase().includes(q)
        )
        .slice(0, 8)   // máximo 8 sugerencias
        .map(u => ({
            account: u.account,
            name:    u.name    || '',
            dept:    u.dept    || '',
            enabled: u.enabled,
        }));

    res.json({ success: true, data: results });
});

// ============================================================================
// GET /api/ad/cache-status — estado del cache (útil para debug)
// ============================================================================
router.get('/cache-status', (req, res) => {
    const now = Date.now();
    res.json({
        success: true,
        refreshRunning,
        ttlMs: CACHE_TTL,
        entries: {
            kpis:    { loaded: !!cache.kpis.data,    ageSeconds: Math.round((now - cache.kpis.ts)    / 1000) },
            stale:   { loaded: !!cache.stale.data,   ageSeconds: Math.round((now - cache.stale.ts)   / 1000) },
            offline: { loaded: !!cache.offline.data, ageSeconds: Math.round((now - cache.offline.ts) / 1000) },
        }
    });
});

// ============================================================================
// POST /api/ad/refresh — forzar refresh manual del cache
// ============================================================================
router.post('/refresh', async (req, res) => {
    if (refreshRunning) return res.json({ success: true, message: 'Refresh ya en curso...' });
    refreshCache();
    res.json({ success: true, message: 'Refresh iniciado en background' });
});

module.exports = router;
