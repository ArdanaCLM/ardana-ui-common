/**
 * (c) Copyright 2015-2017 Hewlett Packard Enterprise Development LP
 * (c) Copyright 2017 SUSE LLC
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
