import { analytics, logEvent } from './firebase-analytics.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('contactForm');
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const messageInput = document.getElementById('message');
    const subjectInput = document.getElementById('subject');
    const submitBtn = document.getElementById('submitBtn');
    const statusMessage = document.getElementById('statusMessage');

    // Auto-fill hidden subject with context
    const setSubject = () => {
        const time = new Date().toLocaleString();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        subjectInput.value = `New Support Request from Website | ${time} | ${timezone}`;
    };
    setSubject();

    const showError = (element, message) => {
        const errorText = document.getElementById(`${element.id}Error`);
        element.classList.add('border-red-500');
        errorText.innerText = message;
        errorText.classList.remove('hidden');
    };

    const clearError = (element) => {
        const errorText = document.getElementById(`${element.id}Error`);
        element.classList.remove('border-red-500');
        errorText.classList.add('hidden');
    };

    const validate = () => {
        let isValid = true;

        if (!nameInput.value.trim()) {
            showError(nameInput, 'Name is required');
            isValid = false;
        } else {
            clearError(nameInput);
        }

        const email = emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email) {
            showError(emailInput, 'Email address is required');
            isValid = false;
        } else if (!emailRegex.test(email)) {
            showError(emailInput, 'Please enter a valid email address');
            isValid = false;
        } else {
            clearError(emailInput);
        }

        if (!messageInput.value.trim()) {
            showError(messageInput, 'Message cannot be empty');
            isValid = false;
        } else {
            clearError(messageInput);
        }
        return isValid;
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!validate()) return;

        // Robot Check (Honeypot) - if filled, it's a bot
        const honeypot = document.getElementById('honeypot').value;
        if (honeypot) {
            console.log("Bot detected.");
            return;
        }

        // UI Loading State
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
        submitBtn.disabled = true;
        statusMessage.classList.add('hidden');

        try {
            const token = await new Promise((resolve) => {
                grecaptcha.enterprise.ready(() => {
                    grecaptcha.enterprise.execute('6LfReqgtAAAAAMB5fwAruBn0tI48BDOpUvr98BCl', { action: 'submit' }).then(resolve);
                });
            });

            const formData = new FormData(form);
            formData.append('recaptcha_token', token);

            const response = await fetch('send_email.php', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                // Log Analytics Event
                logEvent(analytics, 'contact_form_send');

                statusMessage.className = 'mt-4 p-4 rounded-xl text-sm font-medium bg-green-50 text-green-700 border border-green-200';
                statusMessage.innerHTML = '✨ Message sent successfully! We will get back to you soon.';
                form.reset();
                setSubject(); // Reset subject timestamp
            } else {
                throw new Error(result.message || 'Failed to send message.');
            }
        } catch (error) {
            statusMessage.className = 'mt-4 p-4 rounded-xl text-sm font-medium bg-red-50 text-red-700 border border-red-200';
            statusMessage.innerHTML = '⚠️ ' + error.message;
        } finally {
            statusMessage.classList.remove('hidden');
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        }
    });

    // Initial check
    const updateSubmitButton = () => {
        const email = emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isValid = nameInput.value.trim() && email && emailRegex.test(email) && messageInput.value.trim();
        submitBtn.disabled = !isValid;
        if (isValid) {
            submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            submitBtn.classList.add('hover:bg-yellow-600', 'shadow-lg');
        } else {
            submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
            submitBtn.classList.remove('hover:bg-yellow-600', 'shadow-lg');
        }
    };

    // Real-time validation on input
    [nameInput, emailInput, messageInput].forEach(input => {
        input.addEventListener('input', () => {
            clearError(input);
            updateSubmitButton();
        });
    });

    // Initialize button state
    updateSubmitButton();

    // No manual page_view here: GA4 collects page_view automatically via Enhanced
    // Measurement. Firing it by hand as well double-counted every visit.
});
