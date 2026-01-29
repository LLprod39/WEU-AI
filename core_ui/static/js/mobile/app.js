/**
 * WEU AI Mobile App - Core Application
 * Main entry point for mobile functionality
 */

(function() {
    'use strict';

    // Mobile App Singleton
    window.MobileApp = {
        isInitialized: false,
        
        // Initialize the mobile app
        init: function() {
            if (this.isInitialized) return;
            
            this.initDrawer();
            this.initHeader();
            this.initToast();
            this.initPullToRefresh();
            this.initNetworkStatus();
            this.initGestures();
            
            this.isInitialized = true;
            console.log('[MobileApp] Initialized');
        },
        
        // Drawer menu functionality
        initDrawer: function() {
            var moreBtn = document.getElementById('mobile-more-btn');
            var drawer = document.getElementById('mobile-more-drawer');
            var closeBtn = document.getElementById('mobile-drawer-close');
            var overlay = drawer ? drawer.querySelector('.mobile-drawer-overlay') : null;
            
            if (!moreBtn || !drawer) return;
            
            var openDrawer = function() {
                drawer.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            };
            
            var closeDrawer = function() {
                drawer.classList.add('hidden');
                document.body.style.overflow = '';
            };
            
            moreBtn.addEventListener('click', openDrawer);
            
            if (closeBtn) {
                closeBtn.addEventListener('click', closeDrawer);
            }
            
            if (overlay) {
                overlay.addEventListener('click', closeDrawer);
            }
            
            // Close on escape
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && !drawer.classList.contains('hidden')) {
                    closeDrawer();
                }
            });
            
            // Store references
            this.drawer = {
                element: drawer,
                open: openDrawer,
                close: closeDrawer
            };
        },
        
        // Header functionality
        initHeader: function() {
            var header = document.getElementById('mobile-header');
            var main = document.getElementById('mobile-main');
            
            if (!header || !main) return;
            
            var lastScrollTop = 0;
            var headerHeight = header.offsetHeight;
            
            // Auto-hide header on scroll (optional - uncomment if needed)
            /*
            main.addEventListener('scroll', function() {
                var scrollTop = main.scrollTop;
                
                if (scrollTop > lastScrollTop && scrollTop > headerHeight) {
                    // Scrolling down
                    header.style.transform = 'translateY(-100%)';
                } else {
                    // Scrolling up
                    header.style.transform = 'translateY(0)';
                }
                
                lastScrollTop = scrollTop;
            });
            */
        },
        
        // Toast notification system
        initToast: function() {
            var container = document.getElementById('mobile-toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'mobile-toast-container';
                container.className = 'mobile-toast-container';
                document.body.appendChild(container);
            }
            
            this.toastContainer = container;
        },
        
        // Show toast notification
        showToast: function(message, type, duration) {
            type = type || 'info';
            duration = duration || 3000;
            
            var toast = document.createElement('div');
            toast.className = 'mobile-toast ' + type;
            toast.innerHTML = 
                '<span class="mobile-toast-message">' + this.escapeHtml(message) + '</span>' +
                '<button type="button" class="mobile-toast-close">' +
                    '<span class="material-icons-round">close</span>' +
                '</button>';
            
            var closeBtn = toast.querySelector('.mobile-toast-close');
            var self = this;
            
            closeBtn.addEventListener('click', function() {
                self.hideToast(toast);
            });
            
            this.toastContainer.appendChild(toast);
            
            // Auto-hide after duration
            setTimeout(function() {
                self.hideToast(toast);
            }, duration);
            
            return toast;
        },
        
        // Hide toast notification
        hideToast: function(toast) {
            if (!toast || !toast.parentNode) return;
            
            toast.style.animation = 'fadeOut 0.2s ease forwards';
            setTimeout(function() {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 200);
        },
        
        // Pull to refresh
        initPullToRefresh: function() {
            var main = document.getElementById('mobile-main');
            if (!main) return;
            
            var startY = 0;
            var pulling = false;
            var threshold = 80;
            
            main.addEventListener('touchstart', function(e) {
                if (main.scrollTop === 0) {
                    startY = e.touches[0].pageY;
                    pulling = true;
                }
            }, { passive: true });
            
            main.addEventListener('touchmove', function(e) {
                if (!pulling) return;
                
                var currentY = e.touches[0].pageY;
                var diff = currentY - startY;
                
                if (diff > 0 && diff < threshold * 2) {
                    // Visual feedback can be added here
                }
            }, { passive: true });
            
            main.addEventListener('touchend', function(e) {
                if (!pulling) return;
                
                var endY = e.changedTouches[0].pageY;
                var diff = endY - startY;
                
                if (diff > threshold) {
                    // Trigger refresh
                    if (typeof window.onMobileRefresh === 'function') {
                        window.onMobileRefresh();
                    } else {
                        window.location.reload();
                    }
                }
                
                pulling = false;
            }, { passive: true });
        },
        
        // Network status indicator
        initNetworkStatus: function() {
            var statusDot = document.getElementById('mobile-connection-status');
            if (!statusDot) return;
            
            var updateStatus = function() {
                if (navigator.onLine) {
                    statusDot.classList.add('online');
                    statusDot.classList.remove('offline');
                    statusDot.title = 'Онлайн';
                } else {
                    statusDot.classList.remove('online');
                    statusDot.classList.add('offline');
                    statusDot.title = 'Оффлайн';
                }
            };
            
            window.addEventListener('online', updateStatus);
            window.addEventListener('offline', updateStatus);
            updateStatus();
        },
        
        // Initialize gesture handling
        initGestures: function() {
            if (window.MobileGestures) {
                window.MobileGestures.init();
            }
        },
        
        // Utility: Escape HTML
        escapeHtml: function(str) {
            var div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        
        // Utility: Format relative time
        formatRelativeTime: function(date) {
            var now = new Date();
            var diff = Math.floor((now - new Date(date)) / 1000);
            
            if (diff < 60) return 'только что';
            if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
            if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
            if (diff < 604800) return Math.floor(diff / 86400) + ' дн назад';
            
            return new Date(date).toLocaleDateString('ru-RU');
        },
        
        // Utility: Debounce
        debounce: function(func, wait) {
            var timeout;
            return function() {
                var context = this;
                var args = arguments;
                clearTimeout(timeout);
                timeout = setTimeout(function() {
                    func.apply(context, args);
                }, wait);
            };
        },
        
        // Utility: Throttle
        throttle: function(func, limit) {
            var inThrottle;
            return function() {
                var context = this;
                var args = arguments;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(function() {
                        inThrottle = false;
                    }, limit);
                }
            };
        },
        
        // Show loading overlay
        showLoading: function(message) {
            var overlay = document.createElement('div');
            overlay.className = 'mobile-loading-overlay';
            overlay.id = 'mobile-loading-overlay';
            overlay.innerHTML = 
                '<div class="flex flex-col items-center gap-4">' +
                    '<div class="mobile-spinner"></div>' +
                    (message ? '<span class="text-sm text-gray-400">' + this.escapeHtml(message) + '</span>' : '') +
                '</div>';
            document.body.appendChild(overlay);
        },
        
        // Hide loading overlay
        hideLoading: function() {
            var overlay = document.getElementById('mobile-loading-overlay');
            if (overlay) {
                overlay.remove();
            }
        },
        
        // Navigate to page
        navigateTo: function(url) {
            window.location.href = url;
        },
        
        // Get CSRF token
        getCsrfToken: function() {
            var cookie = document.cookie
                .split(';')
                .find(function(c) { return c.trim().startsWith('csrftoken='); });
            return cookie ? cookie.split('=')[1] : '';
        },
        
        // API call helper
        api: function(url, options) {
            options = options || {};
            options.headers = options.headers || {};
            options.headers['X-CSRFToken'] = this.getCsrfToken();
            options.headers['X-Requested-With'] = 'XMLHttpRequest';
            options.credentials = 'same-origin';
            
            return fetch(url, options)
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    return response.json();
                });
        }
    };

    // Expose showToast globally for compatibility
    window.showToast = function(message, type, duration) {
        if (window.MobileApp && window.MobileApp.showToast) {
            return window.MobileApp.showToast(message, type, duration);
        }
    };

})();
