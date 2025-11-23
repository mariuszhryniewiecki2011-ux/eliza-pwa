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

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initSpeechRecognition();
    initSpeechSynthesis();
    loadChatHistory();
    registerServiceWorker();
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
    // Load voices
    loadVoices();
    
    // Voices might not be loaded immediately
    if (synthesis.onvoiceschanged !== undefined) {
        synthesis.onvoiceschanged = loadVoices;
    }
}

function loadVoices() {
    availableVoices = synthesis.getVoices();
    voiceSelect.innerHTML = '';
    
    // Filter for English and Indonesian voices
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
talkBtn.addEventListener('click', startListening);
stopBtn.addEventListener('click', stopAll);
clearBtn.addEventListener('click', clearChat);

languageSelect.addEventListener('change', (e) => {
    recognition.lang = e.target.value;
    CONFIG.DEFAULT_LANGUAGE = e.target.value;
});

// Core Functions
function startListening() {
    if (!recognition) {
        showError('Speech recognition not initialized');
        return;
    }
    
    try {
        recognition.start();
    } catch (error) {
        console.error('Error starting recognition:', error);
        showError('Could not start listening. Please try again.');
    }
}

function stopAll() {
    if (isListening && recognition) {
        recognition.stop();
    }
    if (isSpeaking && synthesis) {
        synthesis.cancel();
    }
    resetControls();
}

function resetControls() {
    isListening = false;
    isSpeaking = false;
    talkBtn.disabled = false;
    stopBtn.disabled = true;
    updateStatus('Ready to talk', '');
}

async function sendToEliza(message) {
    updateStatus('Thinking...', '');
    
    try {
        // Call your Eliza backend API
        const response = await fetch(CONFIG.ELIZA_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                userId: getUserId(),
                timestamp: new Date().toISOString()
            })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        const elizaResponse = data.response || data.message || 'I heard you, but I need a moment to think.';
        
        addMessage('eliza', elizaResponse);
        speak(elizaResponse);
        
    } catch (error) {
        console.error('Error calling Eliza API:', error);
        
        // Fallback response if API fails
        const fallbackResponse = "I'm having trouble connecting right now, but I'm here with you. Can you try again?";
        addMessage('eliza', fallbackResponse);
        speak(fallbackResponse);
    }
}

function speak(text) {
    if (!synthesis) return;
    
    // Cancel any ongoing speech
    synthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Set voice if selected
    const selectedVoiceIndex = voiceSelect.value;
    if (selectedVoiceIndex && availableVoices[selectedVoiceIndex]) {
        utterance.voice = availableVoices[selectedVoiceIndex];
    }
    
    utterance.lang = CONFIG.DEFAULT_LANGUAGE;
    utterance.rate = 0.9; // Slightly slower for clarity
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    utterance.onstart = () => {
        isSpeaking = true;
        updateStatus('Eliza is speaking...', 'speaking');
    };
    
    utterance.onend = () => {
        isSpeaking = false;
        resetControls();
    };
    
    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        isSpeaking = false;
        resetControls();
    };
    
    synthesis.speak(utterance);
}

function addMessage(sender, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = text;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString();
    
    messageDiv.appendChild(textDiv);
    messageDiv.appendChild(timeDiv);
    
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    // Save to history
    chatHistory.push({
        sender,
        text,
        timestamp: new Date().toISOString()
    });
    
    // Limit history size
    if (chatHistory.length > CONFIG.MAX_CHAT_HISTORY) {
        chatHistory = chatHistory.slice(-CONFIG.MAX_CHAT_HISTORY);
    }
    
    saveChatHistory();
}

function clearChat() {
    if (confirm('Clear all chat messages?')) {
        chatContainer.innerHTML = '';
        chatHistory = [];
        saveChatHistory();
        
        // Add welcome message
        addMessage('eliza', "Chat cleared! I'm ready to talk again. 💙");
    }
}

function updateStatus(message, className) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + (className || '');
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 5000);
}

// Local Storage Functions
function saveChatHistory() {
    try {
        localStorage.setItem('eliza_chat_history', JSON.stringify(chatHistory));
    } catch (error) {
        console.error('Error saving chat history:', error);
    }
}

function loadChatHistory() {
    try {
        const saved = localStorage.getItem('eliza_chat_history');
        if (saved) {
            chatHistory = JSON.parse(saved);
            
            // Render last few messages
            chatHistory.slice(-10).forEach(msg => {
                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${msg.sender}`;
                
                const textDiv = document.createElement('div');
                textDiv.className = 'message-text';
                textDiv.textContent = msg.text;
                
                const timeDiv = document.createElement('div');
                timeDiv.className = 'message-time';
                timeDiv.textContent = new Date(msg.timestamp).toLocaleTimeString();
                
                messageDiv.appendChild(textDiv);
                messageDiv.appendChild(timeDiv);
                
                chatContainer.appendChild(messageDiv);
            });
        }
    } catch (error) {
        console.error('Error loading chat history:', error);
    }
}

function getUserId() {
    let userId = localStorage.getItem('eliza_user_id');
    if (!userId) {
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('eliza_user_id', userId);
    }
    return userId;
}

// Service Worker Registration
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker registration failed:', err));
    }
}

// Handle install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Could show custom install button here
});
