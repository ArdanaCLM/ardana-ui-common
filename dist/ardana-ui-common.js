'use strict';

angular.module('ardanaCommon', [
    'ngWebSocket'
]).constant(
    'constants', {}
);

/**
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

/**
 * @ngdoc service
 * @name ardanaCommon.service:AnsiColoursService
 * @description replaces ANSI color escape sequences with wrapping <span> elements
 */

(function() {
    'use strict';


    angular.module('ardanaCommon')
        .service('AnsiColoursService', function($log) {

            var fgAnsiToNames = {
                30: 'black',
                31: 'red',
                32: 'green',
                33: 'yellow',
                34: 'blue',
                35: 'purple',
                36: 'cyan',
                37: 'white'
            };

            var bgAnsiToNames = {};
            for (var ansiColour in fgAnsiToNames) {
                if (!fgAnsiToNames.hasOwnProperty(ansiColour)) {
                    continue;
                }
                bgAnsiToNames[parseInt(ansiColour) + 10] = fgAnsiToNames[ansiColour];
            }

            var ansiEscapeMatcher = new RegExp('(?:\x1B\\[[0-9;]*m[\n]*)+', 'g');
            var ansiEscapeExtractor = new RegExp('\x1B\\[([0-9;]*)m([\n]*)', 'g');

            this.spanOpen = false;
            this.currentFg = null;
            this.currentBg = null;
            this.boldOn = false;

            function AnsiColouriser() {
                angular.extend(this);
            }

            AnsiColouriser.prototype = {
                reset: function() {
                    this.currentFg = null;
                    this.currentBg = null;
                    this.boldOn = false;
                },

                makeSpan: function() {

                    var span = '';
                    if (this.boldOn || this.currentFg || this.currentBg) {
                        span += '<span class="';
                        if (this.boldOn) {
                            span += 'intense ';
                        }
                        if (this.currentFg) {
                            span += 'ansi-';
                            span += fgAnsiToNames[this.currentFg];
                            span += ' ';
                        }
                        if (this.currentBg) {
                            span += 'ansi-background-';
                            span += bgAnsiToNames[this.currentBg];
                        }
                        span += '">';
                    }

                    var close = '';
                    if (span !== this.spanOpen) {
                        // Close previous span if required
                        if (this.spanOpen) {
                            close = '</span>';
                        }
                        this.spanOpen = span;
                    } else {
//                    $log.debug('Re-using identical open span!: ' + span);
                        span = '';
                    }

                    return close + span;
                },

                smartReplacer: function(match) {
                    // First flatten all consecutive mode switches into a single string
                    var modes = match.replace(ansiEscapeExtractor, this.ansiGroupParser.bind(this)).split(';');
                    var lineFeeds = '';

                    // Support n-modes switching like a real terminal
                    for (var i = 0; i < modes.length - 1; i++) {
                        var mode = parseInt(modes[i]);

                        // Handle line feeds
                        if (mode < 0) {
                            for (var n = mode; n < 0; n++) {
                                lineFeeds += '\n';
                            }
                            continue;
                        }

                        switch (mode) {
                            case 0:
//                            $log.debug('// Reset all!');
                                this.reset();
                                break;
                            case 1:
//                            $log.debug('// Enable bold: ' + mode);
                                this.boldOn = true;
                                break;
                            case 22:
//                            $log.debug('// Disable bold: ' + mode);
                                this.boldOn = false;
                                break;
                            case 39:
//                            $log.debug('// Reset foreground: ' + mode);
                                this.currentFg = null;
                                break;
                            case 49:
//                            $log.debug('// Reset background: ' + mode);
                                this.currentBg = null;
                                break;
                            default:
                                if (mode <= 37 && mode >= 30) {
                                    // Normal foreground colour
//                                $log.debug('// Set foreground colour: ' + mode);
                                    this.currentFg = mode;
                                } else if (mode <= 47 && mode >= 40) {
                                    // Background colour
//                                $log.debug('// Set background colour: ' + mode);
                                    this.currentBg = mode;
                                } else {
                                    $log.debug('// Not yet supported graphics mode: ' + mode);
                                }
                                break;
                        }
                    }
                    // Return a single span with the correct classes for all consecutive SGR parameters
                    return this.makeSpan() + lineFeeds;
                },

                ansiGroupParser: function(match, graphicModes, lineFeeds) {
                    var ret = '';
                    if (lineFeeds) {
                        ret += (-lineFeeds.length) + ';';
                    }
                    if (!graphicModes) {
                        // An empty mode string means reset all
                        return ret + '0;';
                    }

                    // Non empty modes processed as normal
                    return ret + graphicModes + ';';

                },

                ansiColoursToHtml: function(str) {
//                $log.debug('Calling replacer on String: ' + '\n---\n' + str + '\n---\n');
                    str = str.replace(/</g, '&lt;'); //Escape embedded markup
                    return str.replace(ansiEscapeMatcher, this.smartReplacer.bind(this));
                }
            };

            this.getInstance = function() {
                return new AnsiColouriser();
            };

        });
})();

/**
 * @ngdoc service
 * @name ardanaCommon.service:AnsibleService
 * @description manages Ansible runs by interacting with the Nodejs backend.
 * Also manages a WebSocket connection to the backend for streaming logs etc
 */
(function() {
    'use strict';

    angular.module('ardanaCommon')
        .service('AnsibleService', function($http, WebSocketClient, $log, $q, UtilsService, constants) {

            /* Public interface */

            /**
             * @ngdoc property
             * @propertyOf ardanaCommon.service:AnsibleService
             * @name allPlays
             * @description List of all plays metadata, most recently started first
             * We strive to keep this automatically current at all times
             * [Read-only please!]
             */
            this.allPlays = [];

            /**
             * @ngdoc property
             * @propertyOf ardanaCommon.service:AnsibleService
             * @name anyRunning
             * @description Boolean indicating whether *any* ansible play is currently running
             */
            this.anyRunning = undefined;

            /**
             * @ngdoc property
             * @propertyOf ardanaCommon.service:AnsibleService
             * @name liveLogSize
             * @description Map of process references to live log sizes
             * [Read-only please!]
             * */
            this.liveLogSize = {};

            /**
             * @ngdoc property
             * @propertyOf ardanaCommon.service:AnsibleService
             * @name siteRunning
             * @description Boolean indicating whether a site playbook is currently running
             */
            this.siteRunning = undefined;

            /**
             * @ngdoc property
             * @propertyOf ardanaCommon.service:AnsibleService
             * @name siteOrReadyRunning
             * @description Boolean indicating whether a site or ready-deployment playbook is currently running
             */
            this.siteOrReadyRunning = undefined;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name listAnsibleRuns
             * @description Refresh {@link allPlays} using the REST backend
             * @return {Object} A promise which will be resolved after {@link allPlays} has been refreshed
             */
            this.listAnsibleRuns = listAnsibleRuns;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name getPlay
             * @description Get a process metadata by reference
             * @param {string} pRef The reference of the process
             */
            this.getPlay = pRef2Play;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name startListening
             * @description Register a listener for process Start and Stop events
             * @param {function} listener The callback invoked when a processes starts or ends
             * @param {Object=} scope Optional Angular scope object holding the listener.
             *  If provided we'll automatically clear the listener when the scope is destroyed
             * */
            this.startListening = startListening;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name stopListening
             * @description De-register a listener for process Start and Stop events
             * Note: this is invoked automatically when a scope Object was provided to {@link startListening}
             * @param {function} listener The callback to de-register
             * */
            this.stopListening = stopListening;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name notifyProcessEnd
             * @description Get a promise which will be resolved when a process ends
             * @param {string} pRef The reference of the process in question
             * */
            this.notifyProcessEnd = notifyProcessEnd;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name site
             * @description Trigger the site Ansible playbook
             */
            this.site = site;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name status
             * @description Trigger the ardana-status Ansible playbook
             */
            this.status = status;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name takeOffline
             * @description Trigger the ardana-stop Ansible playbook
             */
            this.takeOffline = takeOffline;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name bringOnline
             * @description Trigger the ardana-start Ansible playbook
             */
            this.bringOnline = bringOnline;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name runConfigProcessor
             * @description Trigger the config-processor Ansible playbook
             * @param {Object} opts additional options described below
             *          {string} opts.encryptionKey execute config-processor playbook with the encrypt key set
             *          {boolean} opts.removeDeletedServers execute config-processor playbook with the
             *          remove_deleted_servers key set
             *          {boolean} opts.freeUnusedAddresses execute config-processor playbook with the
             *          free_unused_addresses key set
             */
            this.runConfigProcessor = runConfigProcessor;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name readyDeploy
             * @description Trigger the ready-deployment Ansible playbook
             */
            this.readyDeploy = readyDeploy;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name getLiveLog
             * @description Request a live log via the WebSocket
             * @param {string} pRef The process reference
             * @param {function} messageHandler The callback invoked when log data is received
             * @param {Object=} scope Optional Angular scope object holding the listener.
             *  If provided we'll automatically clear the listener when the scope is destroyed
             * */
            this.getLiveLog = getLiveLog;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name removeLiveLogHandler
             * @description Manually de-register a live log handler
             * @param {string} pRef The process reference for the log
             * @param {function} messageHandler The callback to de-register
             * */
            this.removeLiveLogHandler = removeLiveLogHandler;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name getFinishedLog
             * @description Fetch the log of a terminated process via the REST interface
             * {@see getLiveLog} for live process logs
             * @param {string} pRef The reference of the process
             * */
            this.getFinishedLog = getFinishedLog;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:AnsibleService
             * @name killProcess
             * @description Interrupt (kill -INT) a process by reference
             * @param {string} pRef The reference of the process to kill
             * */
            this.killProcess = killProcess;

            /**
             * Proxy websocket client service reconnect handler methods
             * @see WebSocketClient.addReconnectHandler
             * */
            this.addReconnectHandler = WebSocketClient.addReconnectHandler;

            /**
             * Proxy websocket client service reconnect handler methods
             * @see WebSocketClient.removeReconnectHandler
             * */
            this.removeReconnectHandler = WebSocketClient.removeReconnectHandler;


            /* Internal implementation */
            var that = this;

            var API_ROOT = constants.API_ROOT ? constants.API_ROOT : '/api/v1';

            var PLAYBOOKS_PATH = API_ROOT + '/playbooks';
            var PLAYS_PATH = API_ROOT + '/plays';

            var SITE = /(?:site.yml)/;
            var SITE_OR_READY = /(?:site.yml|ready_deployment.yml)/;

            // For ease of access, maintain a map of pRef to play metadata
            var playMap = {};

            var logHandlers = {};
            var liveLogs = {};
            var processEventHandlers = [];

            function listAnsibleRuns() {
                return $http.get(PLAYS_PATH).then(function(response) {
                    $log.debug('Got list of all plays!');

                    // Empty array but make ensure the pointer is preserved
                    that.allPlays.length = 0;
                    that.allPlays.push.apply(that.allPlays, response.data);

                    // Rebuild the playMap and refresh running flags
                    playMap = {};
                    that.anyRunning = false;
                    that.siteRunning = false;
                    that.siteOrReadyRunning = false;
                    for (var i = 0; i < that.allPlays.length; i++) {
                        var aPlay = that.allPlays[i];
                        playMap[aPlay.pRef] = aPlay;
                        if (aPlay.alive) {
                            that.anyRunning = true;
                            that.siteRunning = that.siteRunning ||
                                (aPlay.commandString && aPlay.commandString.match(SITE));
                            that.siteOrReadyRunning = that.siteRunning || that.siteOrReadyRunning ||
                                (aPlay.commandString && aPlay.commandString.match(SITE_OR_READY));
                        }
                    }
                    return response;
                }, _.partial(UtilsService.logErrorAndReject, 'Failed to list ansible plays'));
            }

            function pRef2Play(pRef) {
                return playMap[pRef];
            }

            function site(opts) {
                return $http.post(PLAYBOOKS_PATH + '/site', opts)
                    .catch(_.partial(UtilsService.logErrorAndReject, 'Failed to execute ansible \'deploy\''));
            }

            function status(opts) {
                return $http.post(PLAYBOOKS_PATH + '/ardana_status', opts)
                    .catch(_.partial(UtilsService.logErrorAndReject, 'Failed to execute ansible \'status\''));
            }

            function killProcess(pRef) {
                return $http.delete(PLAYS_PATH + '/' + pRef, null)
                    .catch(_.partial(UtilsService.logErrorAndReject, 'Failed to kill ansible process'));
            }

            function getFinishedLog(pRef) {
                $log.debug('Requesting log [' + pRef + '] via REST');
                return $http.get(PLAYS_PATH + '/' + pRef + '/log', null).then(function(response) {
                    return response.data.log;
                }, _.partial(UtilsService.logErrorAndReject, 'Failed to fetch logs of finished ansible processes'));
            }

            function takeOffline(serverId, encryptionKey) {
                var data = {
                    limit: serverId
                };
                if (encryptionKey) {
                    data.encryptionKey = encryptionKey;
                }
                return $http.post(PLAYBOOKS_PATH + '/ardana_stop', data)
                    .catch(_.partial(UtilsService.logErrorAndReject,
                        'Failed to take server \'' + serverId + '\' offline'));
            }

            function bringOnline(serverId, encryptionKey) {
                var data = {
                    limit: serverId
                };
                if (encryptionKey) {
                    data.encryptionKey = encryptionKey;
                }
                return $http.post(PLAYBOOKS_PATH + '/ardana_start', data)
                    .catch(_.partial(UtilsService.logErrorAndReject,
                        'Failed to bring server \'' + serverId + '\' online'));
            }

            function runConfigProcessor(opts) {
                opts = opts || {};
                return $http.post(PLAYBOOKS_PATH + '/config_processor_run', {
                    encrypt: opts.encryptionKey,
                    rekey: '', //TODO: implement rekey in modal
                    removeDeletedServers: opts.removeDeletedServers,
                    freeUnusedAddresses: opts.freeUnusedAddresses
                }).catch(_.partial(UtilsService.logErrorAndReject, 'Failed to run ansible config processor'));
            }

            function readyDeploy() {
                return $http.post(PLAYBOOKS_PATH + '/ready_deployment')
                    .catch(_.partial(UtilsService.logErrorAndReject, 'Failed to run ansible ready deploy'));
            }

            /** Provide a way for ui-router to wait for the service to be activated */
            this.activated = WebSocketClient.activated;

            function activate() {

                // When the WebSocket is severed, the live log handlers are lost
                WebSocketClient.addReconnectHandler(function() {
                    liveLogs = {};
                    that.liveLogSize = {};
                    that.listAnsibleRuns();
                });

                WebSocketClient.addHandler(WebSocketClient.MSG.LOG_DATA, function(jsonMessage) {
                    var pRef = jsonMessage.pRef;
                    that.liveLogSize[pRef] += jsonMessage.data.length;
                    liveLogs[pRef] += jsonMessage.data;
                    if (logHandlers[pRef]) {
                        for (var i = 0; i < logHandlers[pRef].length; i++) {
                            logHandlers[pRef][i](jsonMessage.data);
                        }
                    }
                });

                WebSocketClient.addHandler(WebSocketClient.MSG.PROCESS_END, function(jsonMessage) {
                    var pRef = jsonMessage.meta.pRef;

                    // Defer removing handlers to allow soaking up outstanding WebSocket messages
                    setTimeout(function() {
                        delete logHandlers[pRef];
                        delete liveLogs[pRef];
                        delete that.liveLogSize[pRef];
                    });


                    // TODO: smarter update of in memory plays without asking the backend...
                    that.listAnsibleRuns().then(function() {
                            if (processEndPromises[pRef]) {
                                var meta = that.getPlay(pRef);
                                var method = (meta.code === 0) ? 'resolve' : 'reject';
                                for (var i = 0; i < processEndPromises[pRef].length; i++) {
                                    processEndPromises[pRef][i][method](meta);
                                }
                                delete processEndPromises[pRef];
                            }
                            for (var j = 0; j < processEventHandlers.length; j++) {
                                processEventHandlers[j](jsonMessage);
                            }
                        }
                    );
                });

                WebSocketClient.addHandler(WebSocketClient.MSG.PROCESS_START, function(jsonMessage) {
                    // TODO: smarter update of in memory plays without asking the backend...
                    that.listAnsibleRuns().then(function() {
                            for (var i = 0; i < processEventHandlers.length; i++) {
                                processEventHandlers[i](jsonMessage);
                            }
                        }
                    );
                });

            }

            function getLiveLog(pRef, messageHandler) {

                if (!logHandlers.hasOwnProperty(pRef)) {
                    logHandlers[pRef] = [];
                }
                logHandlers[pRef].push(messageHandler);

                if (angular.isUndefined(liveLogs[pRef])) {
                    // Actually requesting log
                    $log.debug('Requesting log [' + pRef + '] via WebSocket');
                    WebSocketClient.send({
                        action: 'getLog',
                        pRef: pRef
                    });
                    liveLogs[pRef] = '';
                    that.liveLogSize[pRef] = 0;
                } else {
                    $log.debug('Handler for log [' + pRef + '] already exists, nothing left to do');
                    messageHandler(liveLogs[pRef]);
                }
            }

            function removeLiveLogHandler(pRef, messageHandler) {
                if (!logHandlers[pRef]) {
                    return;
                }
                var handlerIndex = logHandlers[pRef].indexOf(messageHandler);
                if (handlerIndex > -1) {
                    $log.debug('Found old handler to cleanup');
                    logHandlers[pRef].splice(handlerIndex, 1);
                }
            }

            var processEndPromises = {};

            function notifyProcessEnd(pRef) {
                var deferred = $q.defer();
                if (!processEndPromises[pRef]) {
                    processEndPromises[pRef] = [];
                }
                processEndPromises[pRef].push(deferred);
                return deferred.promise;
            }

            function startListening(listener, scope) {
                processEventHandlers.push(listener);
                if (scope) {
                    scope.$on('$destroy', function() {
                        that.stopListening(listener);
                    });
                }
            }

            function stopListening(listener) {
                var index = processEventHandlers.indexOf(listener);
                if (index > -1) {
                    $log.info('Removing listener on scope destroy');
                    processEventHandlers.splice(index, 1);
                } else {
                    $log.warn('Was asked to remove unregistered listener!');
                }
            }

            activate();

        }
    );
})();

/**
 * @ngdoc service
 * @name ardanaCommon.service:UtilsService
 * @description
 *  General utility functions
 */

(function() {
    'use strict';
    angular.module('ardanaCommon')
        .service('UtilsService', function($log, $q) {

            /**
             * @ngdoc method
             * @name logErrorAndReject
             * @methodOf ardanaCommon.service:UtilsService
             * @description Given a http response construct a common error object, log it at the appropriate level and
             * return a rejected promise containing it.
             * @param {string} message Description of call/failure. This may make it into a Notification
             * @param {object} httpResponse $http response object
             * @returns {object} Rejected promise
             */
            this.logErrorAndReject = logErrorAndReject;

            function logErrorAndReject(message, httpResponse) {
                var error = {
                    status: httpResponse.status,
                    error: _.get(httpResponse, 'data.error'),
                    message: _.get(httpResponse, 'data.message') || message,
                    meta: _.get(httpResponse, 'data.error.pRef') ? httpResponse.data.error : undefined
                };

                if (httpResponse.status === 400) {
                    $log.warn(message, error);
                } else {
                    $log.error(message, error);
                }

                return $q.reject(error);
            }
        });
})();

/**
 * @ngdoc service
 * @name ardanaCommon.service:WebSocketClient
 * @description
 * manages a WebSocket connection to the backend for receiving events, streaming logs etc
 */
(function() {
    'use strict';
    angular.module('ardanaCommon')
        .service('WebSocketClient', function($log, $q, $location, $websocket, $interval) {

            /* Public interface */

            /**
             * @ngdoc property
             * @propertyOf ardanaCommon.service:WebSocketClient
             * @name MSG
             * @description WebSocket API message type keys
             * */
            this.MSG = {
                LOG_DATA: 'logData',
                PROCESS_END: 'processEnd',
                PROCESS_START: 'processStart',
                INPUT_MODEL_CHANGE: 'inputModelChange'
            };

            /**
             * @ngdoc property
             * @propertyOf ardanaCommon.service:WebSocketClient
             * @name activated
             * @description Provide a way for ui-router to wait for the service to be activated
             * */
            this.activated = $q.defer();

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:WebSocketClient
             * @name addHandler
             * @description type, handler
             * @param {string} type Type of message to handle.
             *  See MSG ({@link ardanaCommon.service:WebSocketClient.MSG})
             * @param {function} handler handler to call when a message of require type is received
             * */
            this.addHandler = addHandler;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:WebSocketClient
             * @name removeHandler
             * @description remove a handler
             * @param {function} handler handler to remove
             * */
            this.removeHandler = removeHandler;

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:WebSocketClient
             * @name addReconnectHandler
             * @description reconnectHandler
             * @param {function} reconnectHandler handler to call when the webscoket successfully reconnects
             * after the link was severed
             * */
            this.addReconnectHandler = function(reconnectHandler, scope) {
                that.addHandler('reconnect', reconnectHandler);
                if (scope) {
                    scope.$on('$destroy', function() {
                        that.removeReconnectHandler(reconnectHandler);
                    });
                }
            };

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:WebSocketClient
             * @name removeReconnectHandler
             * @description remove a reconnect handler
             * @param {function} reconnectHandler handler to remove
             * */
            this.removeReconnectHandler = function(reconnectHandler) {
                that.removeHandler('reconnect', reconnectHandler);
            };

            /**
             * @ngdoc method
             * @methodOf ardanaCommon.service:WebSocketClient
             * @name send
             * @description Send a message via the socket
             * @param {object} message message to send
             * */
            this.send = send;


            /* Internal implementation */
            var that = this;

            var webSocketConnection;

            var typeHandlers = {
                reconnect: []
            };

            var reconnectInterval;

            activate();

            function activate() {

                // Initialise empty handler arrays for all message types
                for (var key in that.MSG) {
                    if (!that.MSG.hasOwnProperty(key)) { continue; }
                    typeHandlers[that.MSG[key]] = [];
                }

                // Open a (non reconnecting) WebSocket connection, we handle reconnection more aggressively here
                // FIXME: seems flaky to rely on $location for getting the WebSocket endpoint
                webSocketConnection = $websocket('ws://' + $location.host() + ':' + $location.port() + '/logs', null, {
                    reconnectIfNotNormalClose: false
                });

                webSocketConnection.onMessage(function(message) {

                    var jsonMessage;
                    try {
                        jsonMessage = JSON.parse(message.data);
                    } catch (error) {
                        $log.debug('WebSocket received non JSON data: ' + message.data);
                        return;
                    }

                    // Run all handlers registered for that message type
                    for (var i = 0; i < typeHandlers[jsonMessage.type].length; i++) {
                        typeHandlers[jsonMessage.type][i](jsonMessage);
                    }
                }, {autoApply: false});

                webSocketConnection.onOpen(function(event) {
                    that.activated.resolve();
                    if (angular.isDefined(reconnectInterval)) {
                        $log.debug('WebSocket successfully reconnected, phew ;)', event);
                        $interval.cancel(reconnectInterval);
                        reconnectInterval = undefined;
                        onReconnect();
                    } else {
                        $log.debug('WebSocket connection now open ;)', event);
                    }
                });

                webSocketConnection.onClose(function(event) {
                    if (angular.isDefined(reconnectInterval)) {
                        return;
                    }
                    $log.debug('WebSocket connection severed :\'(', event);
                    that.activated = $q.defer();
                    reconnectInterval = $interval(function() {
                        reconnect();
                    }, 100);
                });
            }

            function addHandler(type, handler) {
                if (!typeHandlers[type]) {
                    $log.error('Ignoring request to add handler for unknown web socket message type \'' + type + '\'');
                    return;
                }
                typeHandlers[type].push(handler);
            }

            function removeHandler(type, handler) {
                if (!typeHandlers[type]) {
                    return;
                }
                var handlerIndex = typeHandlers[type].indexOf(handler);
                if (handler > -1) {
                    $log.debug('Found old handler to cleanup');
                    typeHandlers[handler].splice(handlerIndex, 1);
                }
            }

            function reconnect() {
                if (webSocketConnection.readyState >= webSocketConnection._readyStateConstants.CLOSED) {
                    webSocketConnection._reconnectAttempts = 0;
                    webSocketConnection._connect();
                }
            }

            function validateConnection() {
                if (webSocketConnection.readyState !== webSocketConnection._readyStateConstants.OPEN) {
                    $log.info('Hmm, WebSocket is not open, will try and reconnect now!');
                    reconnect();
                }
            }

            function send(message) {
                validateConnection();
                that.activated.promise.then(function() {
                    webSocketConnection.send(message);
                });
            }

            function onReconnect() {
                for (var i = 0; i < typeHandlers.reconnect.length; i++) {
                    typeHandlers.reconnect[i]();
                }
            }
        });
})();
