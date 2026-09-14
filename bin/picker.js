#!/usr/bin/env node
import { workflow } from '../lib/workflow.js';
import { Cancelled, acknowledge } from '../lib/ui.js';
import { networkError } from '../lib/network.js';
try { await workflow(); }
catch(err) {
  if(err instanceof Cancelled) console.log('Cancelled.');
  else { console.error(networkError(err)); try { await acknowledge('Press Enter to close — fix the problem and rerun to retry'); } catch {} process.exitCode=1; }
}
