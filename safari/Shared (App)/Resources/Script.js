const settings = document.getElementById('settings');
const status = document.getElementById('status');
const instructions = document.getElementById('instructions');
function show(platform, enabled, canOpenSettings) {
    instructions.textContent = platform === 'mac'
        ? 'Open Safari > Settings > Extensions and select Uzero.'
        : 'Open Settings > Apps > Safari > Extensions and select Uzero. On iOS 17, open Settings > Safari > Extensions.';
    settings.hidden = !canOpenSettings;
    status.textContent = platform === 'mac' && typeof enabled === 'boolean'
        ? `Uzero is ${enabled ? 'on' : 'off'} in Safari.`
        : 'Turn on Uzero in Safari settings, then return to Safari.';
}
function settingsError() {
    status.textContent = 'Safari settings could not open. Follow step 1 to open them manually.';
}
settings.addEventListener('click', () => {
    webkit.messageHandlers.controller.postMessage('open-preferences');
});
