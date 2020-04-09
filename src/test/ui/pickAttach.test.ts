/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { spawn, ChildProcessWithoutNullStreams, ChildProcess } from 'child_process';
import { findOpenPort } from '../../common/findOpenPort';
import * as vscode from 'vscode';
import { Contributions } from '../../common/contributionUtils';
import { SinonSandbox, createSandbox } from 'sinon';
import { eventuallyOk } from '../testIntegrationUtils';
import { expect } from 'chai';
import split from 'split2';
import { createFileTree, testFixturesDir } from '../test';
import { resolveProcessId } from '../../ui/processPicker';
import { nodeAttachConfigDefaults } from '../../configuration';

describe('pick and attach', () => {
  let child: ChildProcess;
  let sandbox: SinonSandbox;
  let port: number;
  let attached = false;

  beforeEach(() => (sandbox = createSandbox()));
  afterEach(() => {
    sandbox?.restore();
    child?.kill();
  });

  if (process.platform !== 'win32') {
    it('infers the working directory', async () => {
      createFileTree(testFixturesDir, {
        'foo.js': 'setInterval(() => {}, 1000)',
      });

      child = spawn('node', ['foo.js'], { cwd: testFixturesDir });

      const config = { ...nodeAttachConfigDefaults, processId: `${child.pid}:1234` };
      await resolveProcessId(config, true);
      expect(config.cwd).to.equal(testFixturesDir);
    });

    it('adjusts to the package root', async () => {
      createFileTree(testFixturesDir, {
        'package.json': '{}',
        'nested/foo.js': 'setInterval(() => {}, 1000)',
      });

      child = spawn('node', ['foo.js'], { cwd: testFixturesDir });

      const config = { ...nodeAttachConfigDefaults, processId: `${child.pid}:1234` };
      await resolveProcessId(config, true);
      expect(config.cwd).to.equal(testFixturesDir);
    });
  }

  describe('', () => {
    beforeEach(async () => {
      port = await findOpenPort();
      child = spawn('node', ['--inspect-brk', `--inspect-port=${port}`], { stdio: 'pipe' });
      child.on('error', console.error);
      child
        .stderr!.pipe(split())
        .on('data', (line: string) => (attached = attached || line.includes('Debugger attached')));
    });

    it('end to end', async function () {
      this.timeout(60 * 1000);

      const createQuickPick = sandbox.spy(vscode.window, 'createQuickPick');
      vscode.commands.executeCommand(Contributions.AttachProcessCommand);

      const picker = await eventuallyOk(() => {
        expect(createQuickPick.called).to.be.true;
        return createQuickPick.getCall(0).returnValue;
      });

      const item = await eventuallyOk(() => {
        const i = picker.items.find(item => (item as any).pidAndPort === `${child.pid}:${port}`);
        if (!i) {
          throw new Error('expected quickpick to have item');
        }
        return i;
      }, 10 * 1000);

      picker.selectedItems = [item];
      await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      await eventuallyOk(
        () => expect(attached).to.equal(true, 'expected to have attached'),
        10 * 1000,
      );
    });
  });
});
