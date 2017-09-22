/**
 * (c) Copyright 2015-2017 Hewlett Packard Enterprise Development LP
 * (c) Copyright 2017 SUSE LLC
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
