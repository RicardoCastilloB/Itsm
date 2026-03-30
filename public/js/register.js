// ============================================================================
// public/js/register.js - LÓGICA DEL FORMULARIO DE REGISTRO
// ============================================================================

// Toggle password visibility
const setupPasswordToggles = () => {
    const togglePassword = document.getElementById('togglePassword');
    const toggleConfirmPassword = document.getElementById('toggleConfirmPassword');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    togglePassword.addEventListener('click', function() {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        this.classList.toggle('bi-eye');
        this.classList.toggle('bi-eye-slash');
    });

    toggleConfirmPassword.addEventListener('click', function() {
        const type = confirmPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        confirmPasswordInput.setAttribute('type', type);
        this.classList.toggle('bi-eye');
        this.classList.toggle('bi-eye-slash');
    });
};

// Validar fortaleza de contraseña
const checkPasswordStrength = (password) => {
    let strength = 0;
    const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
    };

    // Actualizar UI de requisitos
    document.getElementById('req-length').classList.toggle('valid', requirements.length);
    document.getElementById('req-uppercase').classList.toggle('valid', requirements.uppercase);
    document.getElementById('req-lowercase').classList.toggle('valid', requirements.lowercase);
    document.getElementById('req-number').classList.toggle('valid', requirements.number);

    // Calcular fortaleza
    if (requirements.length) strength++;
    if (requirements.uppercase) strength++;
    if (requirements.lowercase) strength++;
    if (requirements.number) strength++;
    if (requirements.special) strength++;

    // Actualizar barra de fortaleza
    const strengthBar = document.getElementById('strengthBar');
    strengthBar.className = 'password-strength-bar';

    if (strength <= 2) {
        strengthBar.classList.add('strength-weak');
    } else if (strength <= 4) {
        strengthBar.classList.add('strength-medium');
    } else {
        strengthBar.classList.add('strength-strong');
    }

    return requirements.length && requirements.uppercase && requirements.lowercase && requirements.number;
};

// Validar que las contraseñas coincidan
const checkPasswordsMatch = () => {
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const confirmInput = document.getElementById('confirmPassword');

    if (confirmPassword && password !== confirmPassword) {
        confirmInput.classList.add('is-invalid');
        confirmInput.classList.remove('is-valid');
        return false;
    } else if (confirmPassword) {
        confirmInput.classList.remove('is-invalid');
        confirmInput.classList.add('is-valid');
        return true;
    }
    return false;
};

// Validar username en tiempo real
const validateUsername = () => {
    const username = document.getElementById('username');
    const value = username.value;
    const isValid = /^[a-zA-Z0-9_]{3,50}$/.test(value);

    if (value.length > 0) {
        username.classList.toggle('is-invalid', !isValid);
        username.classList.toggle('is-valid', isValid);
    }

    return isValid;
};

// Función para mostrar alertas
const showAlert = (message, type = 'danger') => {
    const alertContainer = document.getElementById('alertContainer');
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            <i class="bi bi-${type === 'danger' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'check-circle'} me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    alertContainer.innerHTML = alertHtml;

    // Auto-dismiss después de 5 segundos
    setTimeout(() => {
        const alert = alertContainer.querySelector('.alert');
        if (alert) {
            const bsAlert = new bootstrap.Alert(alert);
            bsAlert.close();
        }
    }, 5000);

    // Scroll al top para ver la alerta
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Validar email en tiempo real
const validateEmail = () => {
    const email = document.getElementById('email');
    const value = email.value;
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

    if (value.length > 0) {
        email.classList.toggle('is-invalid', !isValid);
        email.classList.toggle('is-valid', isValid);
    }

    return isValid;
};

// Verificar si CIP existe (opcional)
const checkCIPExists = async (cip) => {
    if (!cip || cip.trim() === '') return true; // CIP es opcional

    try {
        const response = await fetch(`/api/employees/search?q=${encodeURIComponent(cip)}`);
        const data = await response.json();
        
        if (data.success && data.data.length > 0) {
            // Buscar coincidencia exacta
            const exactMatch = data.data.find(emp => emp.cip === cip);
            return !!exactMatch;
        }
        return false;
    } catch (error) {
        console.error('Error verificando CIP:', error);
        return true; // No bloquear el registro si hay error
    }
};

// Manejar el submit del formulario
const handleSubmit = async (e) => {
    e.preventDefault();

    const form = document.getElementById('registerForm');
    const registerBtn = document.getElementById('registerBtn');
    const registerBtnText = document.getElementById('registerBtnText');
    const registerBtnSpinner = document.getElementById('registerBtnSpinner');

    // Validar formulario
    if (!form.checkValidity()) {
        e.stopPropagation();
        form.classList.add('was-validated');
        showAlert('Por favor, completa todos los campos requeridos correctamente.', 'warning');
        return;
    }

    // Validaciones adicionales
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const termsAccepted = document.getElementById('termsAccepted').checked;

    if (!checkPasswordStrength(password)) {
        showAlert('La contraseña no cumple con los requisitos mínimos de seguridad.', 'warning');
        return;
    }

    if (password !== confirmPassword) {
        showAlert('Las contraseñas no coinciden.', 'warning');
        return;
    }

    if (!termsAccepted) {
        showAlert('Debes aceptar los términos y condiciones.', 'warning');
        return;
    }

    // Deshabilitar botón y mostrar spinner
    registerBtn.disabled = true;
    registerBtnText.classList.add('d-none');
    registerBtnSpinner.classList.remove('d-none');

    // Verificar CIP si se proporcionó
    const cipInput = document.getElementById('employee_cip').value.trim();
    if (cipInput) {
        const cipExists = await checkCIPExists(cipInput);
        if (!cipExists) {
            showAlert('El CIP proporcionado no existe en el sistema. Déjalo vacío si no eres empleado.', 'warning');
            registerBtn.disabled = false;
            registerBtnText.classList.remove('d-none');
            registerBtnSpinner.classList.add('d-none');
            return;
        }
    }

    // Preparar datos
    const formData = {
        username: document.getElementById('username').value.trim(),
        email: document.getElementById('email').value.trim(),
        password: password,
        employee_cip: cipInput || null,
        role: document.getElementById('role').value
    };

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Guardar tokens en localStorage
            localStorage.setItem('accessToken', data.accessToken);
            localStorage.setItem('refreshToken', data.refreshToken);
            localStorage.setItem('user', JSON.stringify(data.user));

            // Mostrar mensaje de éxito
            showAlert('¡Cuenta creada exitosamente! Redirigiendo...', 'success');

            // Redirigir al dashboard después de 2 segundos
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 2000);
        } else {
            // Mostrar errores específicos
            if (data.details && Array.isArray(data.details)) {
                const errors = data.details.map(err => `• ${err.message}`).join('<br>');
                showAlert(`<strong>Errores de validación:</strong><br>${errors}`, 'danger');
            } else {
                showAlert(data.error || 'Error al crear la cuenta. Por favor, intenta de nuevo.', 'danger');
            }

            // Rehabilitar botón
            registerBtn.disabled = false;
            registerBtnText.classList.remove('d-none');
            registerBtnSpinner.classList.add('d-none');
        }
    } catch (error) {
        console.error('Error:', error);
        showAlert('Error de conexión. Por favor, verifica tu conexión e intenta de nuevo.', 'danger');

        // Rehabilitar botón
        registerBtn.disabled = false;
        registerBtnText.classList.remove('d-none');
        registerBtnSpinner.classList.add('d-none');
    }
};

// Inicializar todo cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    // Setup password toggles
    setupPasswordToggles();

    // Password strength checker
    const passwordInput = document.getElementById('password');
    passwordInput.addEventListener('input', (e) => {
        checkPasswordStrength(e.target.value);
        checkPasswordsMatch();
    });

    // Confirm password checker
    const confirmPasswordInput = document.getElementById('confirmPassword');
    confirmPasswordInput.addEventListener('input', checkPasswordsMatch);

    // Username validation
    const usernameInput = document.getElementById('username');
    usernameInput.addEventListener('blur', validateUsername);

    // Email validation
    const emailInput = document.getElementById('email');
    emailInput.addEventListener('blur', validateEmail);

    // Form submit
    const registerForm = document.getElementById('registerForm');
    registerForm.addEventListener('submit', handleSubmit);

    console.log('✅ Formulario de registro inicializado');
});