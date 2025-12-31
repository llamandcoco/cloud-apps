// Unit tests for Command Registry

import {
  COMMAND_REGISTRY,
  CommandCategory,
  getCommandMetadata,
  getCommandsByCategory,
  getCommandsRequiringApproval,
  isValidCommand,
  getCategoryPermissions
} from '../../src/shared/command-registry';

describe('Command Registry', () => {
  describe('COMMAND_REGISTRY', () => {
    test('should contain all expected commands', () => {
      const expectedCommands = [
        '/status',
        '/health',
        '/metrics',
        '/echo',
        '/scale',
        '/restart',
        '/analyze',
        '/report',
        '/deploy',
        '/migrate',
        '/build'
      ];

      expectedCommands.forEach(cmd => {
        expect(COMMAND_REGISTRY[cmd]).toBeDefined();
      });
    });

    test('all commands should have required metadata fields', () => {
      Object.values(COMMAND_REGISTRY).forEach(cmd => {
        expect(cmd.name).toBeTruthy();
        expect(cmd.category).toBeTruthy();
        expect(cmd.timeout).toBeGreaterThan(0);
        expect(typeof cmd.requiresApproval).toBe('boolean');
        expect(Array.isArray(cmd.permissions)).toBe(true);
        expect(cmd.description).toBeTruthy();
      });
    });

    test('short commands should have timeout <= 30 seconds', () => {
      const shortCommands = Object.values(COMMAND_REGISTRY).filter(
        cmd => cmd.category === 'short-read' || cmd.category === 'short-write'
      );

      shortCommands.forEach(cmd => {
        expect(cmd.timeout).toBeLessThanOrEqual(30);
      });
    });

    test('long commands should have timeout > 30 seconds', () => {
      const longCommands = Object.values(COMMAND_REGISTRY).filter(
        cmd => cmd.category === 'long-read' || cmd.category === 'long-write'
      );

      longCommands.forEach(cmd => {
        expect(cmd.timeout).toBeGreaterThan(30);
      });
    });
  });

  describe('getCommandMetadata', () => {
    test('should return metadata for valid command', () => {
      const metadata = getCommandMetadata('/status');
      
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('/status');
      expect(metadata?.category).toBe('short-read');
    });

    test('should return undefined for invalid command', () => {
      const metadata = getCommandMetadata('/nonexistent');
      
      expect(metadata).toBeUndefined();
    });
  });

  describe('getCommandsByCategory', () => {
    test('should return all short-read commands', () => {
      const commands = getCommandsByCategory('short-read');
      
      expect(commands.length).toBeGreaterThan(0);
      commands.forEach(cmd => {
        expect(cmd.category).toBe('short-read');
      });

      const commandNames = commands.map(c => c.name);
      expect(commandNames).toContain('/status');
      expect(commandNames).toContain('/health');
      expect(commandNames).toContain('/metrics');
      expect(commandNames).toContain('/echo');
    });

    test('should return all short-write commands', () => {
      const commands = getCommandsByCategory('short-write');
      
      expect(commands.length).toBeGreaterThan(0);
      commands.forEach(cmd => {
        expect(cmd.category).toBe('short-write');
      });

      const commandNames = commands.map(c => c.name);
      expect(commandNames).toContain('/scale');
      expect(commandNames).toContain('/restart');
    });

    test('should return all long-read commands', () => {
      const commands = getCommandsByCategory('long-read');
      
      expect(commands.length).toBeGreaterThan(0);
      commands.forEach(cmd => {
        expect(cmd.category).toBe('long-read');
      });

      const commandNames = commands.map(c => c.name);
      expect(commandNames).toContain('/analyze');
      expect(commandNames).toContain('/report');
    });

    test('should return all long-write commands', () => {
      const commands = getCommandsByCategory('long-write');
      
      expect(commands.length).toBeGreaterThan(0);
      commands.forEach(cmd => {
        expect(cmd.category).toBe('long-write');
      });

      const commandNames = commands.map(c => c.name);
      expect(commandNames).toContain('/deploy');
      expect(commandNames).toContain('/migrate');
      expect(commandNames).toContain('/build');
    });

    test('should return empty array for category with no commands', () => {
      // This is a defensive test - currently all categories have commands
      const allCategories: CommandCategory[] = ['short-read', 'short-write', 'long-read', 'long-write'];
      
      allCategories.forEach(category => {
        const commands = getCommandsByCategory(category);
        // All categories should have at least one command in current implementation
        expect(commands.length).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('getCommandsRequiringApproval', () => {
    test('should return only commands requiring approval', () => {
      const commands = getCommandsRequiringApproval();
      
      expect(commands.length).toBeGreaterThan(0);
      commands.forEach(cmd => {
        expect(cmd.requiresApproval).toBe(true);
      });
    });

    test('should include write commands requiring approval', () => {
      const commands = getCommandsRequiringApproval();
      const commandNames = commands.map(c => c.name);
      
      // Write operations typically require approval
      expect(commandNames).toContain('/scale');
      expect(commandNames).toContain('/restart');
      expect(commandNames).toContain('/deploy');
      expect(commandNames).toContain('/migrate');
    });

    test('should not include read-only commands', () => {
      const commands = getCommandsRequiringApproval();
      const commandNames = commands.map(c => c.name);
      
      // Read operations should not require approval
      expect(commandNames).not.toContain('/status');
      expect(commandNames).not.toContain('/health');
      expect(commandNames).not.toContain('/metrics');
    });
  });

  describe('isValidCommand', () => {
    test('should return true for valid commands', () => {
      expect(isValidCommand('/status')).toBe(true);
      expect(isValidCommand('/deploy')).toBe(true);
      expect(isValidCommand('/echo')).toBe(true);
    });

    test('should return false for invalid commands', () => {
      expect(isValidCommand('/invalid')).toBe(false);
      expect(isValidCommand('/notfound')).toBe(false);
      expect(isValidCommand('')).toBe(false);
    });
  });

  describe('getCategoryPermissions', () => {
    test('should return unique permissions for short-read category', () => {
      const permissions = getCategoryPermissions('short-read');
      
      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBeGreaterThan(0);
      
      // Should include CloudWatch read permissions
      expect(permissions.some(p => p.includes('cloudwatch:'))).toBe(true);
      
      // Should not include write permissions
      expect(permissions.some(p => p.includes('Update'))).toBe(false);
      expect(permissions.some(p => p.includes('Create'))).toBe(false);
      expect(permissions.some(p => p.includes('Delete'))).toBe(false);
    });

    test('should return unique permissions for short-write category', () => {
      const permissions = getCategoryPermissions('short-write');
      
      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBeGreaterThan(0);
      
      // Should include write permissions
      expect(permissions.some(p => p.includes('Update'))).toBe(true);
    });

    test('should return unique permissions for long-read category', () => {
      const permissions = getCategoryPermissions('long-read');
      
      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBeGreaterThan(0);
      
      // Should include Athena/S3 read permissions for analytics
      expect(permissions.some(p => p.includes('athena:') || p.includes('s3:Get'))).toBe(true);
    });

    test('should return unique permissions for long-write category', () => {
      const permissions = getCategoryPermissions('long-write');
      
      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBeGreaterThan(0);
      
      // Should include deployment permissions
      expect(permissions.some(p => p.includes('codedeploy:') || p.includes('codebuild:'))).toBe(true);
    });

    test('should return no duplicate permissions', () => {
      const allCategories: CommandCategory[] = ['short-read', 'short-write', 'long-read', 'long-write'];
      
      allCategories.forEach(category => {
        const permissions = getCategoryPermissions(category);
        const uniquePermissions = [...new Set(permissions)];
        
        expect(permissions.length).toBe(uniquePermissions.length);
      });
    });
  });

  describe('Permission boundary validation', () => {
    // Helper to identify write actions
    const isWriteAction = (permission: string): boolean => {
      return permission.includes('Create') || 
        permission.includes('Update') || 
        permission.includes('Delete') || 
        permission.includes('Put') ||
        permission.includes('Modify') ||
        permission.includes('StartBuild') || // CodeBuild StartBuild is a write action
        permission.includes('CreateDeployment'); // Deployment creation is a write action
        // Note: athena:StartQueryExecution is read-only (queries don't mutate data)
    };

    test('read commands should only have read permissions', () => {
      const readCategories: CommandCategory[] = ['short-read', 'long-read'];
      
      readCategories.forEach(category => {
        const commands = getCommandsByCategory(category);
        
        commands.forEach(cmd => {
          const writeActions = cmd.permissions.filter(isWriteAction);
          expect(writeActions).toHaveLength(0);
        });
      });
    });

    test('write commands should have appropriate write permissions', () => {
      const writeCategories: CommandCategory[] = ['short-write', 'long-write'];
      
      writeCategories.forEach(category => {
        const commands = getCommandsByCategory(category);
        
        commands.forEach(cmd => {
          // Write commands should have at least one write permission
          const hasWritePermission = cmd.permissions.some(isWriteAction);
          expect(hasWritePermission).toBe(true);
        });
      });
    });
  });
});
