// static/js/theme.js
(function() {
    function applyTheme(theme) {
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }
    
    // Immediate execution blocking render to prevent flash
    const savedTheme = localStorage.getItem('lexai_theme_pref') || 'system';
    applyTheme(savedTheme);

    // Provide a binding API for when the DOM loads the dropdown
    window.initThemeSelector = function(selectorId) {
        const selector = document.getElementById(selectorId);
        if(!selector) return;
        
        selector.value = savedTheme;
        selector.addEventListener('change', (e) => {
            const val = e.target.value;
            localStorage.setItem('lexai_theme_pref', val);
            applyTheme(val);
        });

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (localStorage.getItem('lexai_theme_pref') === 'system' || !localStorage.getItem('lexai_theme_pref')) {
                applyTheme('system');
            }
        });
    }
})();
