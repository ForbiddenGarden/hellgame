'use strict';
const { makeHandler } = require('../lib/handler');
const { defaultStore } = require('../lib/store');
const content = require('../content/game.json');

module.exports = makeHandler({ store: defaultStore(), content, hostKey: process.env.HOST_KEY });
