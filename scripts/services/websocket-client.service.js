/**
 * (c) Copyright 2015-2017 Hewlett Packard Enterprise Development LP
 * (c) Copyright 2017 SUSE LLC
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
