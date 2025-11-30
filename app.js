// Eliza PWA - Voice Interaction App
// Configuration
const CONFIG = {
    // UPDATE THIS with your actual Eliza backend API endpoint
    ELIZA_API_URL: 'https://eliza-voice-32197952105.us-east5.run.app/',
    // Example: 'https://eliza-voice-32197952105.us-east5.run.app/'
    
    DEFAULT_LANGUAGE: 'en-US',
    MAX_CHAT_HISTORY: 50
};

// State
let recognition = null;
let synthesis = window.speechSynthesis;
let isListening = false;
let isSpeaking = false;
let chatHistory = [];
let availableVoices = [];

// DOM Elements
const statusEl = document.getElementById('status');
const chatContainer = document.getElementById('chatContainer');
const talkBtn = document.getElementById('talkBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const languageSelect = document.getElementById('languageSelect');
const voiceSelect = document.getElementById('voiceSelect');
const errorMessage = document.getElementById('errorMessage');
const openCartesiaBtn = document.getElementById('openCartesiaBtn'); // new
const cartesiaContainer = document.getElementById('cartesia'); // new

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initSpeechRecognition();
    initSpeechSynthesis();
    loadChatHistory();
    registerServiceWorker();

    // Initialize Cartesia (non-blocking). Requires cartesia-init.js and CDN be loaded.
    if (window.initCartesia) {
        const cartesiaKey = window.__CARTESIA_KEY__ || null;
        window.initCartesia('cartesia', cartesiaKey)
            .then(instance => {
                window._cartesiaInstance = instance;
                if (openCartesiaBtn) openCartesiaBtn.disabled = false;
            })
            .catch(err => {
                console.warn('Cartesia initialization failed:', err);
                if (openCartesiaBtn) openCartesiaBtn.disabled = true;
            });
    } else {
        if (openCartesiaBtn) openCartesiaBtn.disabled = true;
    }
});

// Speech Recognition Setup
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        showError('Speech recognition not supported in this browser');
        return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = CONFIG.DEFAULT_LANGUAGE;
    
    recognition.onstart = () => {
        isListening = true;
        updateStatus('Listening...', 'listening');
        talkBtn.disabled = true;
        stopBtn.disabled = false;
    };
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        addMessage('user', transcript);
        sendToEliza(transcript);
    };
    
    recognition.onerror = (event) => {
        console.error('Recognition error:', event.error);
        showError(`Speech recognition error: ${event.error}`);
        resetControls();
    };
    
    recognition.onend = () => {
        isListening = false;
        if (!isSpeaking) {
            resetControls();
        }
    };
}

// Speech Synthesis Setup
function initSpeechSynthesis() {
    loadVoices();
    if (synthesis.onvoiceschanged !== undefined) {
        synthesis.onvoiceschanged = loadVoices;
    }
}

function loadVoices() {
    availableVoices = synthesis.getVoices();
    voiceSelect.innerHTML = '';
    
    const relevantVoices = availableVoices.filter(voice => 
        voice.lang.startsWith('en') || voice.lang.startsWith('id')
    );
    
    relevantVoices.forEach((voice, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${voice.name} (${voice.lang})`;
        if (voice.lang === CONFIG.DEFAULT_LANGUAGE) {
            option.selected = true;
        }
        voiceSelect.appendChild(option);
    });
}

// Event Handlers
// (remains unchanged)
// Core Functions
// (remains unchanged)

// Service Worker Registration
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker registration failed:', err));
    }
}
