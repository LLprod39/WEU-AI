/**
 * WEU AI Mobile Gestures
 * Touch gesture handling for swipe, long-press, etc.
 */

(function() {
    'use strict';

    window.MobileGestures = {
        // Configuration
        config: {
            swipeThreshold: 50,      // Minimum distance for swipe
            swipeVelocity: 0.3,      // Minimum velocity for swipe
            longPressDelay: 500,     // Long press delay in ms
            doubleTapDelay: 300      // Double tap delay in ms
        },
        
        // Initialize gesture handling
        init: function() {
            this.initSwipeableItems();
            console.log('[MobileGestures] Initialized');
        },
        
        // Create swipeable item
        initSwipeableItems: function() {
            var swipeContainers = document.querySelectorAll('.mobile-swipe-container');
            var self = this;
            
            swipeContainers.forEach(function(container) {
                self.makeSwipeable(container);
            });
        },
        
        // Make an element swipeable
        makeSwipeable: function(container) {
            var content = container.querySelector('.mobile-swipe-content');
            if (!content) return;
            
            var startX = 0;
            var startY = 0;
            var currentX = 0;
            var isDragging = false;
            var isHorizontal = null;
            var maxSwipe = -160; // Max swipe distance
            
            var onTouchStart = function(e) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                isDragging = true;
                isHorizontal = null;
                content.style.transition = 'none';
            };
            
            var onTouchMove = function(e) {
                if (!isDragging) return;
                
                var diffX = e.touches[0].clientX - startX;
                var diffY = e.touches[0].clientY - startY;
                
                // Determine scroll direction on first move
                if (isHorizontal === null) {
                    isHorizontal = Math.abs(diffX) > Math.abs(diffY);
                }
                
                // Only handle horizontal swipes
                if (!isHorizontal) {
                    isDragging = false;
                    return;
                }
                
                e.preventDefault();
                
                // Limit swipe to left only and within bounds
                currentX = Math.max(maxSwipe, Math.min(0, diffX));
                content.style.transform = 'translateX(' + currentX + 'px)';
            };
            
            var onTouchEnd = function() {
                if (!isDragging) return;
                isDragging = false;
                
                content.style.transition = 'transform 0.3s ease';
                
                // Snap to open or closed position
                if (currentX < maxSwipe / 2) {
                    content.style.transform = 'translateX(' + maxSwipe + 'px)';
                    container.classList.add('swiped');
                } else {
                    content.style.transform = 'translateX(0)';
                    container.classList.remove('swiped');
                }
                
                currentX = 0;
            };
            
            // Close when tapping elsewhere
            var closeSwipe = function() {
                content.style.transition = 'transform 0.3s ease';
                content.style.transform = 'translateX(0)';
                container.classList.remove('swiped');
            };
            
            content.addEventListener('touchstart', onTouchStart, { passive: true });
            content.addEventListener('touchmove', onTouchMove, { passive: false });
            content.addEventListener('touchend', onTouchEnd, { passive: true });
            
            // Store close function for external access
            container.closeSwipe = closeSwipe;
        },
        
        // Add swipe listener to an element
        onSwipe: function(element, callback) {
            var startX, startY, startTime;
            var self = this;
            
            element.addEventListener('touchstart', function(e) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                startTime = Date.now();
            }, { passive: true });
            
            element.addEventListener('touchend', function(e) {
                var endX = e.changedTouches[0].clientX;
                var endY = e.changedTouches[0].clientY;
                var endTime = Date.now();
                
                var diffX = endX - startX;
                var diffY = endY - startY;
                var diffTime = endTime - startTime;
                
                var velocity = Math.abs(diffX) / diffTime;
                
                // Check if it's a valid swipe
                if (Math.abs(diffX) > self.config.swipeThreshold && 
                    Math.abs(diffX) > Math.abs(diffY) &&
                    velocity > self.config.swipeVelocity) {
                    
                    var direction = diffX > 0 ? 'right' : 'left';
                    callback({
                        direction: direction,
                        distance: Math.abs(diffX),
                        velocity: velocity
                    });
                }
            }, { passive: true });
        },
        
        // Add long press listener
        onLongPress: function(element, callback) {
            var timer;
            var self = this;
            
            element.addEventListener('touchstart', function(e) {
                timer = setTimeout(function() {
                    callback(e);
                    
                    // Haptic feedback if available
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }, self.config.longPressDelay);
            }, { passive: true });
            
            element.addEventListener('touchend', function() {
                clearTimeout(timer);
            }, { passive: true });
            
            element.addEventListener('touchmove', function() {
                clearTimeout(timer);
            }, { passive: true });
        },
        
        // Add double tap listener
        onDoubleTap: function(element, callback) {
            var lastTap = 0;
            var self = this;
            
            element.addEventListener('touchend', function(e) {
                var currentTime = Date.now();
                var tapLength = currentTime - lastTap;
                
                if (tapLength < self.config.doubleTapDelay && tapLength > 0) {
                    e.preventDefault();
                    callback(e);
                }
                
                lastTap = currentTime;
            });
        },
        
        // Create a pull-down handler
        createPullHandler: function(element, options) {
            options = options || {};
            var threshold = options.threshold || 80;
            var onPull = options.onPull || function() {};
            var onRelease = options.onRelease || function() {};
            
            var startY = 0;
            var pulling = false;
            
            element.addEventListener('touchstart', function(e) {
                if (element.scrollTop === 0) {
                    startY = e.touches[0].pageY;
                    pulling = true;
                }
            }, { passive: true });
            
            element.addEventListener('touchmove', function(e) {
                if (!pulling) return;
                
                var currentY = e.touches[0].pageY;
                var diff = currentY - startY;
                
                if (diff > 0) {
                    var progress = Math.min(diff / threshold, 1);
                    onPull(progress, diff);
                }
            }, { passive: true });
            
            element.addEventListener('touchend', function(e) {
                if (!pulling) return;
                
                var endY = e.changedTouches[0].pageY;
                var diff = endY - startY;
                
                onRelease(diff >= threshold);
                pulling = false;
            }, { passive: true });
        }
    };

})();
