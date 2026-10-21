/*
 * Surplus Food Bridge - js/login.js
 * Handles the login form, the register form, and the role-based fields
 * on index.html. Runs only when document.body.dataset.page === 'login'.
 */

// ---------- ENTRY POINT ----------
// Every page includes every script, so each file guards itself with this
// data-page check and does nothing on pages it doesn't own.
document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'login') return;
    initLoginPage();
});

async function initLoginPage() {
    // If someone is already logged in, send them straight to their dashboard
    const existingUser = await fetchCurrentUser();
    if (existingUser) {
        redirectToDashboard(existingUser.role);
        return;
    }

    document.querySelectorAll('[data-auth-view]').forEach(function (link) {
        link.addEventListener('click', function (event) {
            event.preventDefault();
            toggleAuthView(link.getAttribute('data-auth-view'));
        });
    });

    populateZoneDropdown();
    wireRoleToggle();
    wireDigitsOnlyPhoneInput(document.getElementById('regPhone'));

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginError = document.getElementById('loginError');

    loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        handleLogin(loginError);
    });

    registerForm.addEventListener('submit', function (event) {
        event.preventDefault();
        handleRegister(registerForm);
    });
}

// ---------- REGISTER FORM SETUP ----------
function populateZoneDropdown() {
    const zoneSelect = document.getElementById('regZone');
    ZONES.forEach(function (zone) {
        const option = document.createElement('option');
        option.value = zone.id;
        option.textContent = zone.name;
        zoneSelect.appendChild(option);
    });
}

// The description field only makes sense for donors (it shows up on
// their public supplier profile), so hide it when NGO is selected.
function wireRoleToggle() {
    const roleSelect = document.getElementById('regRole');
    const donorFields = document.getElementById('donorFields');

    const label = document.getElementById('regRegistrationLabel');
    const input = document.getElementById('regRegistrationNumber');

    roleSelect.addEventListener('change', function () {
        donorFields.classList.toggle('d-none', roleSelect.value !== 'donor');
        // The number an admin verifies depends on who is registering.
        const isNgo = roleSelect.value === 'ngo';
        label.textContent = isNgo ? 'NGO registration number' : 'Food licence (FSSAI) number';
        input.placeholder = isNgo ? 'e.g. E-12345 (Mumbai)' : 'e.g. 11522998000123';
    });
}

// ---------- LOGIN ----------
async function handleLogin(loginError) {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
        const user = await loginRequest(username, password);
        loginError.classList.add('d-none');
        redirectToDashboard(user.role);
    } catch (err) {
        loginError.textContent = err.status === 401 ? 'Invalid username or password.' : err.message;
        loginError.classList.remove('d-none');
    }
}

// ---------- REGISTER ----------
async function handleRegister(registerForm) {
    const role = document.getElementById('regRole').value;
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const zoneId = document.getElementById('regZone').value;
    const phoneInput = document.getElementById('regPhone');
    const phone = phoneInput.value.trim();
    const address = document.getElementById('regAddress').value.trim();
    const registrationNumber = document.getElementById('regRegistrationNumber').value.trim();

    if (!isValidPhone(phone)) {
        phoneInput.setCustomValidity('Enter exactly 10 digits.');
        phoneInput.reportValidity();
        return;
    }
    phoneInput.setCustomValidity('');

    if (!role || !name || !username || !password || !zoneId || !phone || !address || !registrationNumber) {
        alert('Please fill in every field before registering.');
        return;
    }

    const newUser = {
        username: username,
        password: password,
        role: role,
        name: name,
        zoneId: zoneId,
        phone: phone,
        address: address,
        registrationNumber: registrationNumber
    };

    if (role === 'donor') {
        newUser.description = document.getElementById('regDescription').value.trim();
    }

    try {
        await registerRequest(newUser);
    } catch (err) {
        alert(err.message);
        return;
    }

    alert('Registration received. You can log in now, and an admin will review your details before you can post or claim food.');

    registerForm.reset();
    document.getElementById('donorFields').classList.add('d-none');
    toggleAuthView('login');
}

// ---------- VIEW SWITCHING / REDIRECT ----------
// Called from the "Register here" / "Login here" links in index.html
function toggleAuthView(view) {
    const loginView = document.getElementById('loginView');
    const registerView = document.getElementById('registerView');
    const loginError = document.getElementById('loginError');

    loginError.classList.add('d-none');

    if (view === 'register') {
        loginView.classList.add('d-none');
        registerView.classList.remove('d-none');
    } else {
        registerView.classList.add('d-none');
        loginView.classList.remove('d-none');
    }
}

function redirectToDashboard(role) {
    window.location.href = dashboardUrlForRole(role);
}
