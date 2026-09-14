"""Disposable real Git worktrees, fake env values. No Herdr/Docker session."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('prepare.py')

class SetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='workflow-setup-test-')
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'main source'
        self.repo.mkdir()
        self.git('init', '-q')
        (self.repo / '.gitignore').write_text('.env\n.env.local\n.claude/*/local\n')
        for name in ['web','worker','api','auth']:
            p=self.repo/'apps'/name;p.mkdir(parents=True)
            (p/'code.txt').write_text('tracked')
            (p/('.env.local' if name=='auth' else '.env')).write_text('EXAMPLE=fixture-only\n')
        for name in ['commands','skills','docs']:
            p=self.repo/'.claude'/name/'local';p.mkdir(parents=True)
            (p/'fixture.txt').write_text('shared docs')
        self.git('add','.')
        self.git('-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture')
        self.tree=self.root/"agent's worktree λ"
        self.git('worktree','add','--detach',str(self.tree),'HEAD')
        self.machine=self.root/'machine.json'
        self.machine.write_text(json.dumps({'version':2,'repositories':{'project':str(self.repo)}}))
    def tearDown(self): self.tmp.cleanup()
    def git(self,*args,cwd=None):
        return subprocess.run(['git','-C',str(cwd or self.repo),*args],check=True,capture_output=True,text=True)
    def prepare(self,*args,target=True,env=None):
        e={k:v for k,v in os.environ.items() if not k.startswith('HERDR_')};e.update(env or {})
        cmd=[sys.executable,str(SCRIPT),'--machine',str(self.machine)]
        if target:cmd+=['--worktree',str(self.tree)]
        return subprocess.run(cmd+list(args),env=e,capture_output=True,text=True)
    def test_private_copy_links_and_clean_git(self):
        p=self.prepare();self.assertEqual(p.returncode,0,p.stderr)
        for name in ['web','worker','api']:
            f=self.tree/'apps'/name/'.env'
            self.assertEqual(f.read_text(),'EXAMPLE=fixture-only\n')
            self.assertEqual(f.stat().st_mode & 0o777,0o600)
            self.assertFalse(f.is_symlink())
        self.assertTrue((self.tree/'.claude/skills/local').is_symlink())
        self.assertNotIn('fixture-only',p.stdout+p.stderr)
        self.assertEqual(self.git('status','--porcelain',cwd=self.tree).stdout,'')
    def test_idempotent_preserves_changes(self):
        self.assertEqual(self.prepare().returncode,0)
        f=self.tree/'apps/web/.env';f.write_text('CHANGED')
        self.assertEqual(self.prepare().returncode,0)
        self.assertEqual(f.read_text(),'CHANGED')
        self.assertEqual((self.repo/'apps/web/.env').read_text(),'EXAMPLE=fixture-only\n')
    def test_dry_run(self):
        p=self.prepare('--dry-run');self.assertEqual(p.returncode,0,p.stderr)
        self.assertFalse((self.tree/'apps/web/.env').exists())
        self.assertFalse((self.tree/'.claude').exists())
    def test_missing_source_preflight(self):
        (self.repo/'apps/api/.env').unlink()
        self.assertNotEqual(self.prepare().returncode,0)
        self.assertFalse((self.tree/'apps/web/.env').exists())
    def test_branch_without_api(self):
        self.git('rm','-r','apps/api',cwd=self.tree)
        p=self.prepare();self.assertEqual(p.returncode,0,p.stderr)
        self.assertFalse((self.tree/'apps/api').exists())
    def test_tracked_env(self):
        f=self.tree/'apps/web/.env';f.write_text('tracked fixture')
        self.git('add','-f','apps/web/.env',cwd=self.tree)
        self.assertNotEqual(self.prepare().returncode,0)
        self.assertEqual(f.read_text(),'tracked fixture')
    def test_not_ignored(self):
        (self.tree/'.gitignore').write_text('.claude/*/local\n')
        self.assertNotEqual(self.prepare().returncode,0)
        self.assertFalse((self.tree/'apps/web/.env').exists())
    def test_env_symlink(self):
        (self.tree/'apps/web/.env').symlink_to(self.repo/'apps/web/.env')
        self.assertNotEqual(self.prepare().returncode,0)
    def test_parent_symlink(self):
        (self.tree/'.claude').symlink_to(self.repo/'.claude',target_is_directory=True)
        self.assertNotEqual(self.prepare().returncode,0)
        self.assertFalse((self.tree/'apps/web/.env').exists())
    def test_main_untouched(self):
        self.tree=self.repo;p=self.prepare()
        self.assertEqual(p.returncode,0,p.stderr);self.assertIn('SKIPPED',p.stdout)
    def test_unconfigured_repo(self):
        self.machine.write_text(json.dumps({'version':2,'repositories':{}}))
        p=self.prepare();self.assertEqual(p.returncode,0,p.stderr)
        self.assertFalse((self.tree/'apps/web/.env').exists())
    def test_created_event_beats_focus(self):
        p=self.prepare(target=False,env={'HERDR_PLUGIN_EVENT':'worktree.created',
            'HERDR_PLUGIN_EVENT_JSON':json.dumps({'event':{'worktree':{'path':str(self.tree)}}}),
            'HERDR_PLUGIN_CONTEXT_JSON':json.dumps({'workspace_cwd':str(self.repo)})})
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertTrue((self.tree/'apps/web/.env').exists())
    def test_opened_context_and_manual(self):
        ctx=json.dumps({'worktree':{'checkout_path':str(self.tree),'repo_root':str(self.repo)}})
        p=self.prepare(target=False,env={'HERDR_PLUGIN_EVENT':'worktree.opened','HERDR_PLUGIN_CONTEXT_JSON':ctx})
        self.assertEqual(p.returncode,0,p.stderr)
        p=self.prepare(target=False,env={'HERDR_PLUGIN_CONTEXT_JSON':ctx})
        self.assertEqual(p.returncode,0,p.stderr)
    def test_event_no_provenance_refuses_focus(self):
        p=self.prepare(target=False,env={'HERDR_PLUGIN_EVENT':'worktree.created',
            'HERDR_PLUGIN_CONTEXT_JSON':json.dumps({'workspace_cwd':str(self.tree)})})
        self.assertNotEqual(p.returncode,0)
        self.assertFalse((self.tree/'apps/web/.env').exists())
    def test_auth(self):
        self.machine.write_text(json.dumps({'version':2,'repositories':{'auth':str(self.repo)}}))
        p=self.prepare();self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual((self.tree/'apps/auth/.env.local').read_text(),'EXAMPLE=fixture-only\n')

    def test_machine_settings_from_plugin_config(self):
        env={k:v for k,v in os.environ.items() if not k.startswith('HERDR_')}
        env['HERDR_PLUGIN_CONFIG_DIR']=str(self.root)
        result=subprocess.run([sys.executable,str(SCRIPT),'--worktree',str(self.tree),'--dry-run','--require-configured'],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('CHECK PASSED',result.stdout)
        self.assertFalse((self.tree/'apps/web/.env').exists())

if __name__=='__main__':unittest.main(verbosity=2)
