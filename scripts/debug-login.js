// debug-login.js - Script para diagnosticar problemas de login

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();


async function debugLogin() {
    let connection;
    
    try {
        console.log('\n🔍 DIAGNÓSTICO DE LOGIN');
        console.log('═'.repeat(80));

        // 1. Conectar a la base de datos
        console.log('\n1️⃣ Verificando conexión a la base de datos...');
        connection = await mysql.createConnection({
            host: process.env.EQUIPMENT_HOST || 'localhost',
            user: process.env.EQUIPMENT_USER || 'ricardo',
            password: process.env.EQUIPMENT_PASSWORD,
            database: process.env.EQUIPMENT_DATABASE || 'equipment_management',
            port: process.env.EQUIPMENT_PORT || 3306
        });
        console.log('   ✅ Conexión exitosa');

        // 2. Verificar que la tabla users existe
        console.log('\n2️⃣ Verificando tabla users...');
        const [tables] = await connection.execute(
            "SHOW TABLES LIKE 'users'"
        );
        if (tables.length === 0) {
            console.log('   ❌ La tabla "users" NO existe');
            return;
        }
        console.log('   ✅ Tabla "users" existe');

        // 3. Ver estructura de la tabla
        console.log('\n3️⃣ Estructura de la tabla users:');
        const [columns] = await connection.execute('DESCRIBE users');
        console.log('\n   Columnas:');
        columns.forEach(col => {
            console.log(`   - ${col.Field} (${col.Type}) ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'}`);
        });

        // 4. Verificar usuarios existentes
        console.log('\n4️⃣ Usuarios en la base de datos:');
        const [users] = await connection.execute(
            'SELECT id, username, email, role, is_active, password_hash FROM users'
        );
        
        if (users.length === 0) {
            console.log('   ❌ NO hay usuarios en la base de datos');
            console.log('\n   💡 Solución: Ejecuta generate-users.js para crearlos');
            return;
        }

        console.log(`\n   Total de usuarios: ${users.length}\n`);
        users.forEach(user => {
            console.log(`   👤 ${user.username}`);
            console.log(`      ID: ${user.id}`);
            console.log(`      Email: ${user.email || 'NO DEFINIDO'}`);
            console.log(`      Rol: ${user.role || 'NO DEFINIDO'}`);
            console.log(`      Activo: ${user.is_active ? '✅' : '❌'}`);
            console.log(`      Password Hash: ${user.password_hash ? user.password_hash.substring(0, 30) + '...' : '❌ NO DEFINIDO'}`);
            console.log('');
        });

        // 5. Probar autenticación de admin
        console.log('\n5️⃣ Probando autenticación del usuario "admin":');
        
        const [adminUsers] = await connection.execute(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            ['admin', 'admin']
        );

        if (adminUsers.length === 0) {
            console.log('   ❌ Usuario "admin" NO encontrado');
            console.log('\n   💡 Solución: Crea el usuario admin');
            return;
        }

        const adminUser = adminUsers[0];
        console.log(`   ✅ Usuario "admin" encontrado (ID: ${adminUser.id})`);

        // Verificar si está activo
        if (!adminUser.is_active) {
            console.log('   ❌ Usuario está INACTIVO');
            console.log('\n   💡 Solución: Ejecuta este SQL:');
            console.log(`      UPDATE users SET is_active = 1 WHERE id = ${adminUser.id};`);
            return;
        }
        console.log('   ✅ Usuario está activo');

        // Verificar password_hash
        if (!adminUser.password_hash) {
            console.log('   ❌ password_hash está VACÍO');
            console.log('\n   💡 Solución: Ejecuta generate-users.js para regenerar');
            return;
        }
        console.log('   ✅ password_hash existe');

        // 6. Probar contraseñas
        console.log('\n6️⃣ Probando contraseñas:');
        
        const passwordsToTest = [
            'Admin123!',
            'admin',
            'admin123',
            'Admin123',
            'password'
        ];

        let passwordFound = false;
        
        for (const password of passwordsToTest) {
            try {
                const isMatch = await bcrypt.compare(password, adminUser.password_hash);
                if (isMatch) {
                    console.log(`   ✅ CONTRASEÑA CORRECTA: "${password}"`);
                    passwordFound = true;
                    break;
                } else {
                    console.log(`   ❌ "${password}" - NO coincide`);
                }
            } catch (error) {
                console.log(`   ⚠️  "${password}" - Error al comparar: ${error.message}`);
            }
        }

        if (!passwordFound) {
            console.log('\n   ⚠️  NINGUNA de las contraseñas comunes coincide');
            console.log('\n   💡 El hash actual es inválido o la contraseña es otra');
            console.log('   💡 Solución: Regenera el usuario con generate-users.js');
        }

        // 7. Generar nuevos hashes
        console.log('\n7️⃣ Generando nuevos hashes para las contraseñas estándar:');
        
        const newHashes = {};
        for (const [user, password] of Object.entries({
            admin: 'Admin123!',
            editor: 'Editor123!',
            visor: 'Visor123!'
        })) {
            const hash = await bcrypt.hash(password, 10);
            newHashes[user] = hash;
            console.log(`\n   ${user.toUpperCase()}:`);
            console.log(`   Contraseña: ${password}`);
            console.log(`   Hash: ${hash}`);
            console.log(`\n   SQL para actualizar:`);
            console.log(`   UPDATE users SET password_hash = '${hash}' WHERE username = '${user}';`);
        }

        // 8. Verificar campos de la tabla
        console.log('\n8️⃣ Verificando campos críticos:');
        
        const requiredColumns = [
            'username',
            'password_hash',
            'is_active',
            'role'
        ];

        const columnNames = columns.map(col => col.Field);
        
        for (const col of requiredColumns) {
            if (columnNames.includes(col)) {
                console.log(`   ✅ Columna "${col}" existe`);
            } else {
                console.log(`   ❌ Columna "${col}" NO existe`);
                console.log(`      💡 Esta columna es REQUERIDA para el login`);
            }
        }

        // 9. Verificar si hay password en lugar de password_hash
        if (columnNames.includes('password') && !columnNames.includes('password_hash')) {
            console.log('\n   ⚠️  PROBLEMA ENCONTRADO:');
            console.log('      La tabla tiene "password" pero el código busca "password_hash"');
            console.log('\n   💡 Solución: Renombra la columna:');
            console.log('      ALTER TABLE users CHANGE password password_hash VARCHAR(255);');
        }

        console.log('\n═'.repeat(80));
        console.log('✅ DIAGNÓSTICO COMPLETO');
        console.log('═'.repeat(80));

    } catch (error) {
        console.error('\n❌ Error durante el diagnóstico:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n✅ Conexión cerrada\n');
        }
    }
}

// Ejecutar diagnóstico
debugLogin().catch(console.error);