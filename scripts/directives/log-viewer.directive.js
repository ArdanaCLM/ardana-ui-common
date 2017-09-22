/**
 * (c) Copyright 2015-2017 Hewlett Packard Enterprise Development LP
 * (c) Copyright 2017 SUSE LLC
 * @ngdoc directive
 * @name ardanaCommon.directive:logViewer
 * @description Display log of a process
 *
 */

(function() {

    'use strict';

    angular.module('ardanaCommon')
        .directive('logViewer', function($log, AnsibleService, AnsiColoursService) {

            // Access elements directly for better performance with large and fast logs
            var logContainer;
            var logTextArea;

            // Minimize browser reflow cost by saving old log chunks into
            // static divs and only append to a small 'active' div
            var logDivCapacity = 16 * 1024;

            // Scroll handler defined in controller needs to be attached by link
            var handleScroll;

            return {
                restrict: 'E',
                template: '<div class="log-container"></div>',
                replace: true,
                scope: {
                    pRef: '=',
                    autoScrollOn: '=',
                    filter: '='
                },
                controllerAs: 'logViewer',
                bindToController: true,

                link: function(scope, logContainerJq) {
                    logContainer = logContainerJq[0];
                    logContainerJq.on('scroll', handleScroll);
                },

                controller: function($scope) {
                    var logViewer = this;

                    var colouriser = AnsiColoursService.getInstance();

                    var logDivId = 0;

                    // Batch up appends to DOM to save reflow costs
                    var batchDelayMs = 33;

                    function requestLog() {
                        resetLog();
                        if (handleLogMessage) {
                            AnsibleService.removeLiveLogHandler(handleLogMessage.pRef, handleLogMessage);
                        }
                        if (logViewer.pRef) {
                            var meta = AnsibleService.getPlay(logViewer.pRef);
                            // If no meta, it's likely because we don't have it yet, so assume live
                            if (!meta || meta.alive) {
                                AnsibleService.getLiveLog(logViewer.pRef, makeLogHandler());
                            } else {
                                AnsibleService.getFinishedLog(logViewer.pRef).then(function(logData) {
                                    if (angular.isFunction(logViewer.filter)) {
                                        logData = logViewer.filter(logData);
                                    }
                                    logViewer.currentLog = colouriser.ansiColoursToHtml(logData);
                                    appendLog();
                                });
                            }
                        }
                    }

                    function makeLogDiv() {
                        $(logContainer).append('<div id="logDiv-' + (++logDivId) + '" style="width: 100%;"></div>');
                        logTextArea = angular.element('#logDiv-' + logDivId)[0];
                        logViewer.currentLog = '';
                    }

                    function updateAutoScroll() {
                        // We need to allow 1px for flex layout pixel rounding
                        logViewer.autoScrollOn =
                            logContainer.scrollTop + 1 >= logContainer.scrollHeight - logContainer.clientHeight;
                    }

                    // Detect user (manual) scroll
                    function scrollHandler() {
                        if (logViewer.automaticScrolled) {
                            // Save on reflow cycles if scroll was automatic
                            logViewer.automaticScrolled = false;
                        } else {
                            // User scroll, update auto scroll
                            $scope.$apply(function() {
                                updateAutoScroll();
                            });
                        }
                    }

                    function autoScroll() {
                        if (logViewer.autoScrollOn) {
                            logViewer.automaticScrolled = true;
                            logContainer.scrollTop = logContainer.scrollHeight - logContainer.clientHeight;
                        }
                    }

                    // When the current log div is full, append a new one
                    function rollNextLogDiv() {
                        if (logViewer.currentLog.length - logDivCapacity > 0) {
                            makeLogDiv();
                        }
                    }

                    function realAppend() {
                        logTextArea.innerHTML = logViewer.currentLog;
                        rollNextLogDiv();
                        autoScroll();
                    }

                    // This debounce is crucial to improving performance on very fast logs
                    var appendLog = _.debounce(realAppend, batchDelayMs, {
                        leading: false,
                        trailing: true,
                        maxWait: batchDelayMs
                    });

                    function resetLog() {
                        $(logContainer).empty();
                        logDivId = 0;
                        makeLogDiv();
                    }

                    var handleLogMessage;

                    function makeLogHandler() {
                        handleLogMessage = function(logData) {
                            if (angular.isFunction(logViewer.filter)) {
                                logData = logViewer.filter(logData);
                            }
                            var htmlMessage = colouriser.ansiColoursToHtml(logData);
                            logViewer.currentLog += htmlMessage;
                            appendLog();
                        };
                        handleLogMessage.pRef = logViewer.pRef;
                        return handleLogMessage;
                    }

                    function reconnectHandler() {
                        // Reset and re-request log to recover cleanly from a disconnect
                        requestLog();
                    }

                    handleScroll = scrollHandler;

                    $scope.$on('$destroy', function() {
                        if (handleLogMessage) {
                            AnsibleService.removeLiveLogHandler(handleLogMessage.pRef, handleLogMessage);
                        }
                        AnsibleService.removeReconnectHandler(reconnectHandler);
                    });

                    $scope.$watch('logViewer.pRef', requestLog);

                    // If the filter is changed on the fly we need to reset
                    $scope.$watch('logViewer.filter', function(newVal, oldVal) {
                        if (newVal === oldVal) return;
                        requestLog();
                    });

                    // If the WebSocket is severed, we need to reset in case we missed messages
                    AnsibleService.addReconnectHandler(reconnectHandler);
                }
            };
        });
})();
