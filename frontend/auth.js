document.addEventListener("DOMContentLoaded", () => {
    // If token exists, redirect to chat page
    const token = localStorage.getItem("tradebot_token");
    if (token) {
        window.location.href = "chat.html";
        return;
    }

    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    
    const toRegisterBtn = document.getElementById("to-register");
    const toLoginBtn = document.getElementById("to-login");

    const loginError = document.getElementById("login-error");
    const loginSuccess = document.getElementById("login-success");
    const registerError = document.getElementById("register-error");
    const registerSuccess = document.getElementById("register-success");

    // Toggle between Login & Register forms
    toRegisterBtn.addEventListener("click", () => {
        loginForm.classList.add("hidden");
        registerForm.classList.remove("hidden");
        clearAlerts();
    });

    toLoginBtn.addEventListener("click", () => {
        registerForm.classList.add("hidden");
        loginForm.classList.remove("hidden");
        clearAlerts();
    });

    function clearAlerts() {
        loginError.classList.add("hidden");
        loginSuccess.classList.add("hidden");
        registerError.classList.add("hidden");
        registerSuccess.classList.add("hidden");
    }

    // Login Form Submit Handler
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearAlerts();

        const username = document.getElementById("login-username").value.trim();
        const password = document.getElementById("login-password").value;

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Login failed.");
            }

            loginSuccess.textContent = "Authentication successful! Redirecting...";
            loginSuccess.classList.remove("hidden");
            
            localStorage.setItem("tradebot_token", data.token);
            localStorage.setItem("tradebot_user", JSON.stringify(data.user));

            setTimeout(() => {
                window.location.href = "chat.html";
            }, 1000);

        } catch (error) {
            loginError.textContent = error.message;
            loginError.classList.remove("hidden");
        }
    });

    // Register Form Submit Handler
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearAlerts();

        const username = document.getElementById("register-username").value.trim();
        const password = document.getElementById("register-password").value;
        const confirmPassword = document.getElementById("register-confirm-password").value;

        if (password !== confirmPassword) {
            registerError.textContent = "Passwords do not match.";
            registerError.classList.remove("hidden");
            return;
        }

        try {
            const response = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Registration failed.");
            }

            registerSuccess.textContent = "Registration successful! You can now log in.";
            registerSuccess.classList.remove("hidden");

            // Switch back to login form after a brief delay
            setTimeout(() => {
                registerForm.classList.add("hidden");
                loginForm.classList.remove("hidden");
                document.getElementById("login-username").value = username;
                document.getElementById("login-password").focus();
                clearAlerts();
            }, 2000);

        } catch (error) {
            registerError.textContent = error.message;
            registerError.classList.remove("hidden");
        }
    });
});
