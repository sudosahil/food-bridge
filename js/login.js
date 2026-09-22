/*
 * Surplus Food Bridge - js/login.js
 * Handles the login form, the register form, and the role-based fields
 * on index.html. Runs only when document.body.dataset.page === 'login'.
 */

document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'login') return;
    initLoginPage();
});

function initLoginPage() {
    // If someone is already logged in, send them straight to their dashboard
    const existingUser = getCurrentUser();
    if (existingUser) {
        redirectToDashboard(existingUser.role);
        return;
    }

    populateZoneDropdown();
    wireRoleToggle();

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

    roleSelect.addEventListener('change', function () {
        donorFields.classList.toggle('d-none', roleSelect.value !== 'donor');
    });
}

async function handleLogin(loginError) {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    const users = await fetchUsers();
    const foundUser = users.find(function (u) {
        return u.username === username && u.password === password;
    });

    if (!foundUser) {
        loginError.classList.remove('d-none');
        return;
    }

    loginError.classList.add('d-none');
    setCurrentUser({
        username: foundUser.username,
        role: foundUser.role,
        name: foundUser.name
    });
    redirectToDashboard(foundUser.role);
}

async function handleRegister(registerForm) {
    const role = document.getElementById('regRole').value;
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const zoneId = document.getElementById('regZone').value;
    const phone = document.getElementById('regPhone').value.trim();
    const address = document.getElementById('regAddress').value.trim();

    if (!role || !name || !username || !password || !zoneId || !phone || !address) {
        alert('Please fill in every field before registering.');
        return;
    }

    const users = await fetchUsers();
    const usernameTaken = users.some(function (u) { return u.username === username; });
    if (usernameTaken) {
        alert('That username is already taken. Please choose another one.');
        return;
    }

    const newUser = {
        username: username,
        password: password,
        role: role,
        name: name,
        zoneId: zoneId,
        phone: phone,
        address: address
    };

    if (role === 'donor') {
        newUser.description = document.getElementById('regDescription').value.trim();
    }

    users.push(newUser);
    await saveUsers(users);

    alert('Registration successful! You can now log in.');

    registerForm.reset();
    document.getElementById('donorFields').classList.add('d-none');
    toggleAuthView('login');
}

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
