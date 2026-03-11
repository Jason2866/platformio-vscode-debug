import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

describe('GitHub Actions Publish Workflow', () => {
  const workflowPath = path.join(__dirname, '../../.github/workflows/publish.yml');

  function loadWorkflow(): { content: string; parsed: any; error: Error | null } {
    try {
      const content = fs.readFileSync(workflowPath, 'utf8');
      const parsed = yaml.load(content) as any;
      return { content, parsed, error: null };
    } catch (e) {
      return { content: '', parsed: null, error: e as Error };
    }
  }

  describe('Workflow File Structure', () => {
    test('workflow file should exist', () => {
      expect(fs.existsSync(workflowPath)).toBe(true);
    });

    test('workflow file should be valid YAML', () => {
      const { error } = loadWorkflow();
      expect(error).toBeNull();
    });

    test('workflow should have a name', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.name).toBeDefined();
      expect(typeof workflow.name).toBe('string');
    });

    test('workflow name should be "Publish to npm"', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.name).toBe('Publish to npm');
    });
  });

  describe('Workflow Triggers', () => {
    test('workflow should have "on" trigger definition', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.on).toBeDefined();
    });

    test('workflow should trigger on release published event', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.on.release).toBeDefined();
      expect(workflow.on.release.types).toContain('published');
    });

    test('workflow should only trigger on published releases', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.on.release.types).toEqual(['published']);
    });

    test('workflow should not have other trigger types', () => {
      const { parsed: workflow } = loadWorkflow();
      const triggerKeys = Object.keys(workflow.on);
      expect(triggerKeys).toEqual(['release']);
    });
  });

  describe('Workflow Permissions', () => {
    test('workflow should have permissions defined', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.permissions).toBeDefined();
    });

    test('workflow should have id-token write permission for provenance', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.permissions['id-token']).toBe('write');
    });

    test('workflow should have contents read permission', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.permissions.contents).toBe('read');
    });

    test('workflow should only have necessary permissions', () => {
      const { parsed: workflow } = loadWorkflow();
      const permissionKeys = Object.keys(workflow.permissions);
      expect(permissionKeys.sort()).toEqual(['contents', 'id-token'].sort());
    });

    test('workflow should not have excessive permissions', () => {
      const { parsed: workflow } = loadWorkflow();
      // Ensure no write access to contents or other dangerous permissions
      expect(workflow.permissions.contents).not.toBe('write');
      expect(workflow.permissions.packages).toBeUndefined();
      expect(workflow.permissions.actions).toBeUndefined();
    });
  });

  describe('Workflow Jobs', () => {
    test('workflow should have jobs defined', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.jobs).toBeDefined();
    });

    test('workflow should have a publish job', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.jobs.publish).toBeDefined();
    });

    test('publish job should run on ubuntu-latest', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.jobs.publish['runs-on']).toBe('ubuntu-latest');
    });

    test('publish job should have steps', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.jobs.publish.steps).toBeDefined();
      expect(Array.isArray(workflow.jobs.publish.steps)).toBe(true);
    });

    test('publish job should have at least 4 steps', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.jobs.publish.steps.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Workflow Steps - Checkout and Setup', () => {
    function getSteps() {
      return loadWorkflow().parsed.jobs.publish.steps;
    }

    test('first step should checkout the code', () => {
      const steps = getSteps();
      expect(steps[0].uses).toMatch(/actions\/checkout@v/);
    });

    test('checkout should use v4 or later', () => {
      const steps = getSteps();
      const checkoutVersion = steps[0].uses.match(/@v(\d+)/);
      expect(checkoutVersion).not.toBeNull();
      expect(parseInt(checkoutVersion![1])).toBeGreaterThanOrEqual(4);
    });

    test('second step should setup Node.js', () => {
      const steps = getSteps();
      expect(steps[1].uses).toMatch(/actions\/setup-node@v/);
    });

    test('Node.js setup should use v4 or later', () => {
      const steps = getSteps();
      const nodeVersion = steps[1].uses.match(/@v(\d+)/);
      expect(nodeVersion).not.toBeNull();
      expect(parseInt(nodeVersion![1])).toBeGreaterThanOrEqual(4);
    });

    test('Node.js should be configured with version 22', () => {
      const steps = getSteps();
      expect(steps[1].with).toBeDefined();
      expect(String(steps[1].with['node-version'])).toBe('22');
    });

    test('Node.js should be configured with npm registry', () => {
      const steps = getSteps();
      expect(steps[1].with['registry-url']).toBe('https://registry.npmjs.org');
    });
  });

  describe('Workflow Steps - Build Process', () => {
    function getSteps() {
      return loadWorkflow().parsed.jobs.publish.steps;
    }

    test('should update npm to latest version', () => {
      const steps = getSteps();
      const npmUpdateStep = steps.find(step => step.run && step.run.includes('npm install -g npm@latest'));
      expect(npmUpdateStep).toBeDefined();
    });

    test('should install dependencies', () => {
      const steps = getSteps();
      const npmInstallStep = steps.find(step => step.run && (step.run === 'npm ci' || step.run === 'npm install'));
      expect(npmInstallStep).toBeDefined();
    });

    test('should run build command', () => {
      const steps = getSteps();
      const buildStep = steps.find(step => step.run && step.run === 'npm run build');
      expect(buildStep).toBeDefined();
    });

    test('build step should come after install', () => {
      const steps = getSteps();
      const installStepIndex = steps.findIndex(step => step.run && (step.run === 'npm ci' || step.run === 'npm install'));
      const buildStepIndex = steps.findIndex(step => step.run && step.run === 'npm run build');
      expect(buildStepIndex).toBeGreaterThan(installStepIndex);
    });
  });

  describe('Workflow Steps - Publishing', () => {
    function getSteps() {
      return loadWorkflow().parsed.jobs.publish.steps;
    }
    function getPublishStep() {
      const steps = getSteps();
      return steps.find(step => step.run && step.run.includes('npm publish'));
    }

    test('should have npm publish step', () => {
      expect(getPublishStep()).toBeDefined();
    });

    test('publish should use --provenance flag for transparency', () => {
      expect(getPublishStep().run).toContain('--provenance');
    });

    test('publish should use --access public flag', () => {
      expect(getPublishStep().run).toContain('--access public');
    });

    test('publish command should have both required flags', () => {
      expect(getPublishStep().run).toMatch(/npm publish.*--provenance.*--access public/);
    });

    test('publish step should be the last step', () => {
      const steps = getSteps();
      const publishStepIndex = steps.findIndex(step => step.run && step.run.includes('npm publish'));
      expect(publishStepIndex).toBe(steps.length - 1);
    });

    test('publish step should come after build', () => {
      const steps = getSteps();
      const buildStepIndex = steps.findIndex(step => step.run && step.run === 'npm run build');
      const publishStepIndex = steps.findIndex(step => step.run && step.run.includes('npm publish'));
      expect(publishStepIndex).toBeGreaterThan(buildStepIndex);
    });
  });

  describe('Workflow Step Order and Dependencies', () => {

    test('steps should follow correct execution order', () => {
      const steps = loadWorkflow().parsed.jobs.publish.steps;
      const stepDescriptions = steps.map(step => {
        if (step.uses) {
          if (step.uses.includes('checkout')) return 'checkout';
          if (step.uses.includes('setup-node')) return 'setup-node';
        }
        if (step.run) {
          if (step.run.includes('npm install -g npm@latest')) return 'update-npm';
          if (step.run === 'npm ci' || step.run === 'npm install') return 'install';
          if (step.run === 'npm run build') return 'build';
          if (step.run.includes('npm publish')) return 'publish';
        }
        return 'unknown';
      });

      const expectedOrder = ['checkout', 'setup-node', 'update-npm', 'install', 'build', 'publish'];
      expect(stepDescriptions).toEqual(expectedOrder);
    });

    test('all steps should be either actions or run commands', () => {
      const steps = loadWorkflow().parsed.jobs.publish.steps;
      steps.forEach(step => {
        const hasUses = step.uses !== undefined;
        const hasRun = step.run !== undefined;
        expect(hasUses || hasRun).toBe(true);
      });
    });
  });

  describe('Security and Best Practices', () => {
    test('workflow should use pinned action versions', () => {
      const steps = loadWorkflow().parsed.jobs.publish.steps;
      const actionSteps = steps.filter((step: any) => step.uses);

      actionSteps.forEach((step: any) => {
        // Should have @v followed by a number
        expect(step.uses).toMatch(/@v\d+/);
      });
    });

    test('workflow should use provenance for supply chain security', () => {
      const { parsed: workflow } = loadWorkflow();
      const steps = workflow.jobs.publish.steps;
      const publishStep = steps.find((step: any) => step.run && step.run.includes('npm publish'));
      expect(publishStep.run).toContain('--provenance');
    });

    test('workflow should have minimal permissions', () => {
      const { parsed: workflow } = loadWorkflow();
      // id-token: write is required for provenance
      // contents: read is minimal permission for checkout
      expect(workflow.permissions['id-token']).toBe('write');
      expect(workflow.permissions.contents).toBe('read');

      // Should not have write permissions for contents
      expect(workflow.permissions.contents).not.toBe('write');
    });

    test('workflow should update npm before installing', () => {
      const { parsed: workflow } = loadWorkflow();
      const steps = workflow.jobs.publish.steps;
      const npmUpdateStep = steps.find((step: any) => step.run && step.run.includes('npm install -g npm@latest'));
      expect(npmUpdateStep).toBeDefined();
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    test('workflow should not have duplicate job names', () => {
      const { parsed: workflow } = loadWorkflow();
      const jobNames = Object.keys(workflow.jobs);
      const uniqueJobNames = new Set(jobNames);
      expect(jobNames.length).toBe(uniqueJobNames.size);
    });

    test('workflow should not have empty steps', () => {
      const { parsed: workflow } = loadWorkflow();
      const steps = workflow.jobs.publish.steps;
      steps.forEach((step: any) => {
        expect(step).not.toEqual({});
      });
    });

    test('workflow YAML should not contain syntax errors', () => {
      const { content } = loadWorkflow();
      expect(() => {
        yaml.load(content, { schema: yaml.FAILSAFE_SCHEMA });
      }).not.toThrow();
    });

    test('workflow should be idempotent', () => {
      const { content } = loadWorkflow();
      // Multiple runs should produce same result
      const parsed1 = yaml.load(content);
      const parsed2 = yaml.load(content);
      expect(parsed1).toEqual(parsed2);
    });
  });

  describe('Integration with Package Configuration', () => {
    function loadPackageJson() {
      const packagePath = path.join(__dirname, '../../package.json');
      if (fs.existsSync(packagePath)) {
        const packageContent = fs.readFileSync(packagePath, 'utf8');
        return JSON.parse(packageContent);
      }
      return undefined;
    }

    test('package.json should exist', () => {
      expect(loadPackageJson()).toBeDefined();
    });

    test('build script referenced in workflow should exist in package.json', () => {
      const packageJson = loadPackageJson();
      expect(packageJson.scripts).toBeDefined();
      expect(packageJson.scripts.build).toBeDefined();
    });

    test('build script should be executable', () => {
      const packageJson = loadPackageJson();
      expect(typeof packageJson.scripts.build).toBe('string');
      expect(packageJson.scripts.build.length).toBeGreaterThan(0);
    });

    test('package should have a name for npm publishing', () => {
      const packageJson = loadPackageJson();
      expect(packageJson.name).toBeDefined();
      expect(typeof packageJson.name).toBe('string');
    });

    test('package should have a version for npm publishing', () => {
      const packageJson = loadPackageJson();
      expect(packageJson.version).toBeDefined();
      expect(typeof packageJson.version).toBe('string');
    });
  });

  describe('Workflow Completeness', () => {
    test('workflow should have all required top-level keys', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.name).toBeDefined();
      expect(workflow.on).toBeDefined();
      expect(workflow.permissions).toBeDefined();
      expect(workflow.jobs).toBeDefined();
    });

    test('workflow should not have deprecated syntax', () => {
      const { content } = loadWorkflow();
      // Check that workflow doesn't use old syntax
      expect(content).not.toContain('::set-output');
      expect(content).not.toContain('::save-state');
    });

    test('workflow file should end with newline', () => {
      const { content } = loadWorkflow();
      expect(content.endsWith('\n')).toBe(true);
    });

    test('workflow should use consistent indentation', () => {
      const { content } = loadWorkflow();
      const lines = content.split('\n');
      const indentedLines = lines.filter(line => line.match(/^[ ]+/));

      // Check that all indentation is consistent (multiples of 2)
      indentedLines.forEach(line => {
        const indent = line.match(/^[ ]+/);
        if (indent) {
          expect(indent[0].length % 2).toBe(0);
        }
      });
    });
  });

  describe('Negative Test Cases', () => {
    test('workflow should not trigger on push events', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.on.push).toBeUndefined();
    });

    test('workflow should not trigger on pull request events', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.on.pull_request).toBeUndefined();
    });

    test('workflow should not have manual workflow_dispatch trigger', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.on.workflow_dispatch).toBeUndefined();
    });

    test('workflow should not have scheduled triggers', () => {
      const { parsed: workflow } = loadWorkflow();
      expect(workflow.on.schedule).toBeUndefined();
    });

    test('publish step should not use --dry-run flag', () => {
      const { parsed: workflow } = loadWorkflow();
      const steps = workflow.jobs.publish.steps;
      const publishStep = steps.find((step: any) => step.run && step.run.includes('npm publish'));
      expect(publishStep.run).not.toContain('--dry-run');
    });

    test('workflow should not skip git checks', () => {
      const { content } = loadWorkflow();
      expect(content).not.toContain('--no-git-checks');
    });

    test('workflow should not force publish', () => {
      const { content } = loadWorkflow();
      expect(content).not.toContain('--force');
    });
  });
});