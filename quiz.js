import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// ------------------ CONFIGURATION ------------------
const API_KEY = "AIzaSyATyqoNXa1DCgqQgkKN5Atu8-m4SBwNJKM"; // <-- PASTE YOUR KEY HERE

// ------------------ DOM ELEMENTS ------------------
const setupForm = document.getElementById('setup-form');
const quizSetup = document.getElementById('quiz-setup');
const quizLoading = document.getElementById('quiz-loading');
const quizTaker = document.getElementById('quiz-taker');
const quizResults = document.getElementById('quiz-results');
const topicInput = document.getElementById('quiz-topic');
const numQuestionsInput = document.getElementById('num-questions');
const questionCounter = document.getElementById('question-counter');
const questionText = document.getElementById('question-text');
const optionsContainer = document.getElementById('options-container');
const nextQuestionBtn = document.getElementById('next-question-btn');
const stopQuizBtn = document.getElementById('stop-quiz-btn');
const finalScoreEl = document.getElementById('final-score');
const finalFeedbackEl = document.getElementById('final-feedback');

// ------------------ STATE VARIABLES ------------------
let quizQuestions = [];
let currentQuestionIndex = 0;
let score = 0;

// ------------------ AI INITIALIZATION ------------------
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ------------------ EVENT LISTENERS ------------------
setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const topic = topicInput.value;
    const numQuestions = numQuestionsInput.value;
    quizSetup.classList.add('hidden');
    quizLoading.classList.remove('hidden');
    await generateQuiz(topic, numQuestions);
});

nextQuestionBtn.addEventListener('click', () => {
    currentQuestionIndex++;
    if (currentQuestionIndex < quizQuestions.length) {
        showQuestion();
    } else {
        showResults();
    }
});

stopQuizBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to stop the quiz?")) {
        window.location.reload();
    }
});

// ------------------ CORE FUNCTIONS ------------------
async function generateQuiz(topic, numQuestions) {
    const prompt = `
        Generate a ${numQuestions}-question multiple-choice quiz on '${topic}'.
        Provide the output in a valid JSON array format. Each object should have:
        {"question": "...", "options": ["...", "...", "..."], "answer": "..."}
        Do not include any text outside of the JSON array.
    `;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const jsonText = response.text().replace(/```json/g, "").replace(/```/g, "").trim();
        quizQuestions = JSON.parse(jsonText);
        
        currentQuestionIndex = 0;
        score = 0;
        quizLoading.classList.add('hidden');
        quizTaker.classList.remove('hidden');
        showQuestion();
    } catch (error) {
        console.error("Error generating quiz:", error);
        alert("Failed to create the quiz. Please try a different topic.");
        window.location.reload();
    }
}

function showQuestion() {
    const question = quizQuestions[currentQuestionIndex];
    questionCounter.innerText = `Question ${currentQuestionIndex + 1}/${quizQuestions.length}`;
    questionText.innerText = question.question;

    optionsContainer.innerHTML = '';
    question.options.forEach(option => {
        const button = document.createElement('button');
        button.innerText = option;
        button.classList.add('option-btn');
        button.addEventListener('click', () => handleOptionSelect(button, option, question.answer));
        optionsContainer.appendChild(button);
    });

    nextQuestionBtn.disabled = true;
    nextQuestionBtn.innerText = (currentQuestionIndex === quizQuestions.length - 1) ? "Finish Quiz" : "Next Question";
}

function handleOptionSelect(selectedButton, selectedOption, correctAnswer) {
    const allOptions = optionsContainer.querySelectorAll('.option-btn');
    allOptions.forEach(btn => btn.disabled = true);

    if (selectedOption === correctAnswer) {
        score++;
        selectedButton.classList.add('correct');
    } else {
        selectedButton.classList.add('incorrect');
        allOptions.forEach(btn => {
            if (btn.innerText === correctAnswer) btn.classList.add('correct');
        });
    }
    nextQuestionBtn.disabled = false;
}

function showResults() {
    quizTaker.classList.add('hidden');
    quizResults.classList.remove('hidden');
    finalScoreEl.innerText = `You scored ${score} out of ${quizQuestions.length}.`;
    
    const percentage = (score / quizQuestions.length) * 100;
    let feedback = percentage > 80 ? "Excellent work!" : percentage > 60 ? "Good job!" : "Keep studying and try again!";
    finalFeedbackEl.innerText = feedback;
}