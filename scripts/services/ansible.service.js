/**
 * (c) Copyright 2015-2017 Hewlett Packard Enterprise Development LP
 * (c) Copyright 2017 SUSE LLC
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
