#!/usr/bin/env node
import {restore} from '../lib/restore.js';
import {acknowledge} from '../lib/ui.js';
try{await restore();}catch(e){console.error(e.message);try{await acknowledge('Press Enter to close');}catch{}process.exitCode=1;}
