// ------------------ DOM ELEMENTS ------------------
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const chatMessages = document.getElementById("chat-messages");

// ------------------ EVENT LISTENERS ------------------
chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userProblem = userInput.value.trim();
    if (!userProblem) return;

    // Use the updated addMessage function for the user's message
    addMessage(userProblem, "user");
    userInput.value = "";

    // Add a loading indicator
    const loadingIndicator = addMessage("Thinking...", "bot", true);

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: userProblem }),
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();

        // Remove the loading indicator before adding the final message
        loadingIndicator.remove();
        // Use the updated addMessage function for the bot's response
        addMessage(data.text, "bot");
    } catch (error) {
        loadingIndicator.remove();
        addMessage("Sorry, something went wrong. Please try again.", "bot");
        console.error("AI Error:", error);
    }
});

// ------------------ HELPER FUNCTIONS ------------------
/**
 * UPDATED: Cleans and formats text, then adds it to the chat interface.
 * @param {string} text The message content.
 * @param {string} sender The sender ('user' or 'bot').
 * @param {boolean} isLoading If true, shows a loading state.
 * @returns {HTMLElement} The created message element.
 */
function addMessage(text, sender, isLoading = false) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", `${sender}-message`);

    if (isLoading) {
        messageElement.classList.add("loading");
        const p = document.createElement("p");
        p.textContent = text; // Use textContent for security
        messageElement.appendChild(p);
    } else if (sender === 'bot') {
        // Step 1: Clean the raw text from the AI to remove unwanted signs
        let cleanText = text
            .replace(/```(?:json|javascript|html|css|python)?/g, '') // Remove code fences and language hints
            .replace(/```/g, '')
            .replace(/\*/g, '')   // Remove asterisks
            .trim();

        // Step 2: Format the cleaned text into proper paragraphs
        const paragraphs = cleanText.split('\n').filter(p => p.trim() !== ''); // Split by newline and remove empty lines

        // If there are no paragraphs, handle it as a single block of text
        if (paragraphs.length === 0) {
            const p = document.createElement('p');
            p.textContent = cleanText;
            messageElement.appendChild(p);
        } else {
            paragraphs.forEach(paraText => {
                const p = document.createElement('p');
                p.textContent = paraText;
                messageElement.appendChild(p);
            });
        }
    } else { // For user messages, just display the text
        const p = document.createElement("p");
        p.textContent = text;
        messageElement.appendChild(p);
    }

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return messageElement;
}
