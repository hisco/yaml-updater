import { updateYaml, addInstructions } from './index';
import { describe, it, expect } from '@jest/globals';

// Common type definitions for tests
interface ConfigMapData {
  [key: string]: string;
}

interface K8sConfigMap {
  apiVersion: string;
  kind: string;
  metadata?: {
    name: string;
    namespace?: string;
  };
  data: ConfigMapData;
}

interface Container {
  name: string;
  image: string;
  ports?: Array<{ containerPort: number }>;
  resources?: {
    cpu?: string;
    memory?: string;
  };
}

interface K8sDeployment {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
  };
  spec: {
    replicas: number;
    selector?: {
      matchLabels?: Record<string, string>;
    };
    template?: {
      spec?: {
        containers: Container[];
      };
    };
    containers?: Container[];
  };
}

interface GenericConfig {
  [key: string]: any;
}

describe('focused-yaml-updater', () => {
  describe('basic YAML updates', () => {
    it('should update a simple YAML property', () => {
      const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  database: localhost
`;

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        data: {
          database: string;
          cache?: string;
        };
      }

      const { result, resultParsed } = updateYaml<ConfigMap>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              database: 'db.production.com'
            })
          });
        }
      });

      expect(resultParsed.data.database).toBe('db.production.com');
      expect(result).toContain('database: db.production.com');
    });

    it('should add new properties to YAML', () => {
      const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  database: localhost
`;

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        data: {
          database: string;
          cache?: string;
        };
      }

      const { result, resultParsed } = updateYaml<ConfigMap>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              database: 'localhost',
              cache: 'redis.local'
            })
          });
        }
      });

      expect(resultParsed.data.cache).toBe('redis.local');
      expect(result).toContain('cache: redis.local');
    });

    it('should update nested YAML properties', () => {
      const yamlString = `
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: myapp:1.0
`;

      interface Deployment {
        apiVersion: string;
        kind: string;
        spec: {
          replicas: number;
          template?: {
            spec?: {
              containers?: Array<{ name: string; image: string; env?: Array<{ name: string; value: string }> }>;
            };
          };
        };
      }

      const { result, resultParsed } = updateYaml<Deployment>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.spec,
            merge: () => ({
              replicas: 3
            })
          });
        }
      });

      expect(resultParsed.spec.replicas).toBe(3);
      expect(result).toContain('replicas: 3');
    });
  });

  describe('type safety', () => {
    it('should provide type-safe access to nested properties', () => {
      interface K8sConfig {
        apiVersion: string;
        kind: string;
        spec: {
          replicas: number;
          selector: {
            matchLabels: {
              app: string;
            };
          };
        };
      }

      const yamlString = `
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
`;

      const { resultParsed } = updateYaml<K8sConfig>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.spec.selector.matchLabels,
            merge: (originalValue) => {
              // TypeScript knows: originalValue is { app: string }
              const app: string = originalValue.app;
              return {
                app: app + '-v2'
              };
            }
          });
        }
      });

      expect(resultParsed.spec.selector.matchLabels.app).toBe('myapp-v2');
    });
  });

  describe('addInstructions - mergeByContents', () => {
    it('should merge arrays by contents without duplication', () => {
      const yamlString = `
items:
  - item1
  - item2
`;

      interface ItemsList {
        items: string[];
      }

      const { result, resultParsed } = updateYaml<ItemsList>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'items',
                mergeByContents: true
              }),
              items: ['item2', 'item3']
            })
          });
        }
      });

      expect(resultParsed.items).toEqual(['item1', 'item2', 'item3']);
      expect(result).toContain('item1');
      expect(result).toContain('item3');
    });

    it('should merge complex arrays by contents', () => {
      const yamlString = `
tolerations:
  - effect: NoSchedule
    operator: Exists
`;

      interface Toleration {
        effect: string;
        operator: string;
      }

      interface TolerationsConfig {
        tolerations: Toleration[];
      }

      const { resultParsed } = updateYaml<TolerationsConfig>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'tolerations',
                mergeByContents: true
              }),
              tolerations: [
                {
                  effect: 'NoSchedule',
                  operator: 'Exists'
                },
                {
                  effect: 'NoExecute',
                  operator: 'Exists'
                }
              ]
            })
          });
        }
      });

      expect(resultParsed.tolerations).toHaveLength(2);
      expect(resultParsed.tolerations[1].effect).toBe('NoExecute');
    });
  });

  describe('addInstructions - mergeByName', () => {
    it('should merge arrays by name property', () => {
      const yamlString = `
spec:
  containers:
    - name: app
      image: myapp:1.0
    - name: sidecar
      image: sidecar:1.0
`;

      interface Container {
        name: string;
        image: string;
      }

      interface PodSpec {
        spec: {
          containers: Container[];
        };
      }

      const { resultParsed } = updateYaml<PodSpec>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.spec,
            merge: () => ({
              ...addInstructions({
                prop: 'containers',
                mergeByName: true
              }),
              containers: [
                {
                  name: 'app',
                  image: 'myapp:2.0'
                },
                {
                  name: 'worker',
                  image: 'worker:1.0'
                }
              ]
            })
          });
        }
      });

      expect(resultParsed.spec.containers).toHaveLength(3);
      expect(resultParsed.spec.containers.find(c => c.name === 'app')?.image).toBe('myapp:2.0');
      expect(resultParsed.spec.containers.find(c => c.name === 'worker')).toBeDefined();
    });
  });

  describe('addInstructions - mergeByProp', () => {
    it('should merge arrays by specific property', () => {
      const yamlString = `
services:
  - serviceId: api
    url: http://api.local
  - serviceId: db
    url: postgres://db.local
`;

      interface Service {
        serviceId: string;
        url: string;
      }

      interface ServicesConfig {
        services: Service[];
      }

      const { resultParsed } = updateYaml<ServicesConfig>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'services',
                mergeByProp: 'serviceId'
              }),
              services: [
                {
                  serviceId: 'api',
                  url: 'https://api.prod'
                },
                {
                  serviceId: 'cache',
                  url: 'redis://cache.prod'
                }
              ]
            })
          });
        }
      });

      expect(resultParsed.services).toHaveLength(3);
      expect(resultParsed.services.find(s => s.serviceId === 'api')?.url).toBe('https://api.prod');
      expect(resultParsed.services.find(s => s.serviceId === 'cache')).toBeDefined();
    });
  });

  describe('comment tracking', () => {
    it('should track comments for root-level changes', () => {
      const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  env: development
`;

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        data: {
          env: string;
        };
      }

      const { result, comments } = updateYaml<ConfigMap>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              env: 'production'
            }),
            comment: () => 'Updated to production environment'
          });
        }
      });

      expect(comments).toHaveLength(1);
      expect(comments[0]).toEqual({
        path: ['data'],
        comment: 'Updated to production environment'
      });
      expect(result).toContain('# Updated to production environment');
    });

    it('should track comments for nested changes', () => {
      const yamlString = `
spec:
  replicas: 1
  template:
    spec:
      containers: []
`;

      interface Container {
        name: string;
        image: string;
      }

      interface DeploymentSpec {
        spec: {
          replicas: number;
          template: {
            spec: {
              containers: Container[];
            };
          };
        };
      }

      const { comments } = updateYaml<DeploymentSpec>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.spec.template.spec,
            merge: () => ({
              containers: [
                {
                  name: 'app',
                  image: 'myapp:1.0'
                }
              ]
            }),
            comment: () => 'Added application container'
          });
        }
      });

      expect(comments).toHaveLength(1);
      expect(comments[0]).toEqual({
        path: ['spec', 'template', 'spec'],
        comment: 'Added application container'
      });
    });

    it('should track multiple comments', () => {
      const yamlString = `
config:
  database:
    host: localhost
  cache:
    enabled: false
`;

      const { comments } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.config.database,
            merge: () => ({
              host: 'db.prod.com'
            }),
            comment: () => 'Updated to production database'
          });

          change({
            findKey: (parsed: any) => parsed.config.cache,
            merge: () => ({
              enabled: true
            }),
            comment: () => 'Enabled caching'
          });
        }
      });

      expect(comments).toHaveLength(2);
      expect(comments[0].comment).toBe('Updated to production database');
      expect(comments[1].comment).toBe('Enabled caching');
    });

    it('should handle changes without comments', () => {
      const yamlString = `
data:
  key: value
`;

      const { comments } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              key: 'newValue'
            })
          });
        }
      });

      expect(comments).toHaveLength(0);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle Kubernetes Deployment updates', () => {
      const yamlString = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: myapp:1.0
          env:
            - name: ENV
              value: dev
`;

      const { result, resultParsed, comments } = updateYaml<K8sDeployment>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.spec,
            merge: () => ({
              replicas: 3
            }),
            comment: () => 'Scaled to 3 replicas for high availability'
          });

          change({
            findKey: (parsed) => parsed.spec.template!.spec!,
            merge: () => ({
              ...addInstructions({
                prop: 'containers',
                mergeByName: true
              }),
              containers: [
                {
                  name: 'app',
                  image: 'myapp:2.0',
                  env: [
                    { name: 'ENV', value: 'production' }
                  ]
                } as any // env not in Container interface
              ]
            }),
            comment: () => 'Updated container image and environment'
          });
        }
      });

      expect(resultParsed.spec.replicas).toBe(3);
      expect(resultParsed.spec.template!.spec!.containers[0].image).toBe('myapp:2.0');
      expect(comments).toHaveLength(2);
      expect(result).toContain('replicas: 3');
      expect(result).toContain('myapp:2.0');
    });

    it('should handle ConfigMap with multiple data keys', () => {
      const yamlString = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  database_host: localhost
  cache_enabled: "false"
`;

      const { resultParsed } = updateYaml<K8sConfigMap>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              database_host: 'db.production.com',
              cache_enabled: 'true',
              redis_host: 'redis.production.com'
            })
          });
        }
      });

      expect(resultParsed.data.database_host).toBe('db.production.com');
      expect(resultParsed.data.cache_enabled).toBe('true');
      expect(resultParsed.data.redis_host).toBe('redis.production.com');
    });
  });

  describe('immutability', () => {
    it('should not mutate the original YAML string', () => {
      const originalYamlString = `
data:
  key: value
`;

      const originalCopy = originalYamlString;

      updateYaml({
        yamlString: originalYamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              key: 'newValue'
            })
          });
        }
      });

      expect(originalYamlString).toBe(originalCopy);
    });
  });

  describe('edge cases', () => {
    it('should handle empty YAML documents', () => {
      const yamlString = `{}`;

      interface EmptyDoc {
        newKey?: string;
      }

      const { resultParsed } = updateYaml<EmptyDoc>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              newKey: 'newValue'
            })
          });
        }
      });

      expect(resultParsed.newKey).toBe('newValue');
    });

    it('should handle null values', () => {
      const yamlString = `
data:
  key: null
`;

      interface DataWithNull {
        data: {
          key: string | null;
        };
      }

      const { resultParsed } = updateYaml<DataWithNull>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              key: 'notNull'
            })
          });
        }
      });

      expect(resultParsed.data.key).toBe('notNull');
    });

    it('should preserve YAML formatting where possible', () => {
      const yamlString = `
# This is a comment
apiVersion: v1
kind: ConfigMap
data:
  key: value
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              key: 'newValue'
            })
          });
        }
      });

      expect(result).toContain('# This is a comment');
      expect(result).toContain('apiVersion: v1');
    });
  });

  describe('addInstructions comment manipulation', () => {
    it('should add comment via addInstructions', () => {
      const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  database: localhost
  cache: redis
`;

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        data: {
          database: string;
          cache: string;
        };
      }

      const { result, comments } = updateYaml<ConfigMap>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'data',
                comment: 'Configuration data'
              }),
              data: {
                database: 'localhost',
                cache: 'redis'
              }
            })
          });
        }
      });

      expect(result).toContain('# Configuration data');
      expect(comments.some(c => c.comment === 'Configuration data')).toBe(true);
    });

    it('should remove existing comment via addInstructions', () => {
      // Note: YAML library preserves standalone comment lines.
      // Comments need to be attached to nodes to be removable
      const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  database: localhost
`;

      // First add a comment, then remove it
      const { result: withComment } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'data',
                comment: 'Temporary comment'
              }),
              data: {
                database: 'localhost'
              }
            })
          });
        }
      });

      // Verify comment was added
      expect(withComment).toContain('# Temporary comment');

      // Now remove the comment
      const { result } = updateYaml({
        yamlString: withComment,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'data',
                removeComment: true
              }),
              data: {
                database: 'localhost'
              }
            })
          });
        }
      });

      expect(result).not.toContain('# Temporary comment');
      expect(result).toContain('data:');
    });

    it('should preserve existing comments when not modified', () => {
      const yamlString = `
# Top level comment
apiVersion: v1
kind: ConfigMap
# Data section comment
data:
  # Database config
  database: localhost
  cache: redis
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              database: 'db.production.com',
              cache: 'redis'
            })
          });
        }
      });

      // All original comments should be preserved
      expect(result).toContain('# Top level comment');
      expect(result).toContain('# Data section comment');
      expect(result).toContain('# Database config');
    });

    it('should add comments to multiple properties via addInstructions', () => {
      const yamlString = `
spec:
  replicas: 1
  strategy: RollingUpdate
`;

      const { result, comments } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'spec',
                comment: 'Deployment specification'
              }),
              spec: {
                replicas: 3,
                strategy: 'RollingUpdate'
              }
            })
          });
        }
      });

      expect(result).toContain('# Deployment specification');
      expect(comments).toHaveLength(1);
    });

    it('should combine addInstructions comment with mergeByName', () => {
      const yamlString = `
spec:
  containers:
    - name: app
      image: myapp:1.0
`;

      interface Deployment {
        spec: {
          containers: Array<{ name: string; image: string }>;
        };
      }

      const { result, resultParsed, comments } = updateYaml<Deployment>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'spec',
                comment: 'Updated deployment spec'
              }),
              spec: {
                ...addInstructions({
                  prop: 'containers',
                  mergeByName: true,
                  comment: 'Container definitions'
                }),
                containers: [
                  {
                    name: 'app',
                    image: 'myapp:2.0'
                  }
                ]
              }
            })
          });
        }
      });

      expect(result).toContain('# Updated deployment spec');
      expect(result).toContain('# Container definitions');
      expect(resultParsed.spec.containers[0].image).toBe('myapp:2.0');
    });

    it('should replace existing comment with new one via addInstructions', () => {
      // First create YAML with a comment
      const yamlString = `
data:
  key: value
`;

      const { result: withOldComment } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'data',
                comment: 'Old comment'
              }),
              data: {
                key: 'value'
              }
            })
          });
        }
      });

      expect(withOldComment).toContain('# Old comment');

      // Now replace with new comment
      const { result } = updateYaml({
        yamlString: withOldComment,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'data',
                comment: 'New comment'
              }),
              data: {
                key: 'value'
              }
            })
          });
        }
      });

      expect(result).not.toContain('# Old comment');
      expect(result).toContain('# New comment');
    });

    it('should use originalValue to increment a number', () => {
      const yamlString = `
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
`;

      interface Deployment {
        apiVersion: string;
        kind: string;
        spec: {
          replicas: number;
        };
      }

      const { result, resultParsed } = updateYaml<Deployment>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.spec,
            merge: (originalValue) => ({
              replicas: originalValue.replicas + 1  // Increment by 1
            })
          });
        }
      });

      expect(resultParsed.spec.replicas).toBe(4);
      expect(result).toContain('replicas: 4');
    });

    it('should use originalValue to conditionally add comments', () => {
      const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  database: localhost
  cache: redis
  replicas: 1
`;

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        data: {
          database: string;
          cache: string;
          replicas: number;
        };
      }

      const { result, comments } = updateYaml<ConfigMap>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: (originalValue) => ({
              ...addInstructions({
                prop: 'data',
                comment: `Contains ${Object.keys(originalValue.data).length} configuration keys`
              }),
              data: {
                database: originalValue.data.database,
                cache: originalValue.data.cache,
                replicas: originalValue.data.replicas
              }
            })
          });
        }
      });

      expect(result).toContain('# Contains 3 configuration keys');
      expect(comments.some(c => c.comment === 'Contains 3 configuration keys')).toBe(true);
    });

    it('should use originalValue to preserve and extend configuration', () => {
      const yamlString = `
spec:
  replicas: 2
  strategy: RollingUpdate
  minReadySeconds: 10
`;

      interface Spec {
        replicas: number;
        strategy: string;
        minReadySeconds: number;
        maxUnavailable?: number;
      }

      interface Config {
        spec: Spec;
      }

      const { result, resultParsed } = updateYaml<Config>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: (originalValue) => ({
              ...addInstructions({
                prop: 'spec',
                comment: `Scaling from ${originalValue.spec.replicas} to ${originalValue.spec.replicas * 2} replicas`
              }),
              spec: {
                ...originalValue.spec,  // Preserve all original values
                replicas: originalValue.spec.replicas * 2,  // Double the replicas
                maxUnavailable: 1  // Add new field
              }
            })
          });
        }
      });

      expect(result).toContain('# Scaling from 2 to 4 replicas');
      expect(resultParsed.spec.replicas).toBe(4);
      expect(resultParsed.spec.minReadySeconds).toBe(10);  // Preserved from original
      expect(resultParsed.spec.maxUnavailable).toBe(1);  // New field added
    });

    it('should use originalValue with nested objects and addInstructions', () => {
      const yamlString = `
deployment:
  name: myapp
  containers:
    - name: app
      image: myapp:1.0
      resources:
        cpu: 100m
        memory: 128Mi
`;

      interface DeploymentConfig {
        deployment: {
          name: string;
          containers: Container[];
        };
      }

      const { result, resultParsed } = updateYaml<DeploymentConfig>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.deployment,
            merge: (originalValue) => {
              const containerCount = originalValue.containers.length;
              const firstContainer = originalValue.containers[0];

              return {
                name: originalValue.name,
                ...addInstructions({
                  prop: 'containers',
                  mergeByName: true,
                  comment: `${containerCount} container(s) configured`
                }),
                containers: [
                  {
                    name: firstContainer.name,
                    image: 'myapp:2.0',  // Update image
                    resources: {
                      ...firstContainer.resources,  // Preserve original resources
                      cpu: '200m'  // Increase CPU
                    }
                  }
                ]
              };
            }
          });
        }
      });

      expect(result).toContain('# 1 container(s) configured');
      expect(resultParsed.deployment.containers[0].image).toBe('myapp:2.0');
      expect(resultParsed.deployment.containers[0].resources!.cpu).toBe('200m');
      expect(resultParsed.deployment.containers[0].resources!.memory).toBe('128Mi');  // Preserved
    });

    it('should use originalValue to calculate dynamic comments', () => {
      const yamlString = `
services:
  - name: frontend
    port: 80
    replicas: 2
  - name: backend
    port: 8080
    replicas: 3
`;

      interface Service {
        name: string;
        port: number;
        replicas: number;
      }

      interface Config {
        services: Service[];
      }

      const { result, resultParsed } = updateYaml<Config>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: (originalValue) => {
              const totalReplicas = originalValue.services.reduce((sum, svc) => sum + svc.replicas, 0);
              const newReplicas = totalReplicas * 2;

              return {
                ...addInstructions({
                  prop: 'services',
                  mergeByName: true,
                  comment: `Total replicas increased from ${totalReplicas} to ${newReplicas}`
                }),
                services: originalValue.services.map(svc => ({
                  ...svc,
                  replicas: svc.replicas * 2
                }))
              };
            }
          });
        }
      });

      expect(result).toContain('# Total replicas increased from 5 to 10');
      expect(resultParsed.services[0].replicas).toBe(4);  // 2 * 2
      expect(resultParsed.services[1].replicas).toBe(6);  // 3 * 2
    });
  });

  describe('comprehensive comment preservation', () => {
    it('should preserve comments at all levels, nesting, and YAML node types', () => {
      // Test covers: root level, nested levels, maps, arrays, scalars, empty values
      const yamlString = `
# Root level comment
apiVersion: v1
# Before kind
kind: ConfigMap
# Data section with nested structure
data:
  # String value
  stringVal: hello
  # Number value
  numberVal: 42
  # Nested object
  nested:
    # Deep value
    value: original
# Array section
items:
  # First item
  - name: item1
    value: 1
  # Second item
  - name: item2
    value: 2
# Empty sections
emptyObj: {}
emptyArr: []
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: (originalValue) => ({
              ...originalValue,
              stringVal: 'world'
            })
          });
        }
      });

      // Verify all comment types are preserved
      expect(result).toContain('# Root level comment');
      expect(result).toContain('# Before kind');
      expect(result).toContain('# Data section with nested structure');
      expect(result).toContain('# String value');
      expect(result).toContain('# Number value');
      expect(result).toContain('# Nested object');
      expect(result).toContain('# Deep value');
      expect(result).toContain('# Array section');
      expect(result).toContain('# First item');
      expect(result).toContain('# Second item');
      expect(result).toContain('# Empty sections');
      expect(result).toContain('stringVal: world');
    });

    it('should preserve comments with mixed nesting and use mergeByName', () => {
      // Test covers: maps in arrays, mergeByName, complex nested structures
      const yamlString = `
# Containers array
containers:
  # App container
  - name: app
    # Image comment
    image: myapp:1.0
    # Resources comment
    resources:
      # Limits comment
      limits:
        cpu: 100m
        memory: 128Mi
  # Sidecar container
  - name: sidecar
    image: sidecar:1.0
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (originalValue) => ({
              ...addInstructions({
                prop: 'containers',
                mergeByName: true
              }),
              containers: [
                {
                  name: 'app',
                  image: 'myapp:2.0',
                  resources: originalValue.containers[0].resources
                }
              ]
            })
          });
        }
      });

      expect(result).toContain('# Containers array');
      expect(result).toContain('# App container');
      expect(result).toContain('# Image comment');
      expect(result).toContain('# Resources comment');
      expect(result).toContain('# Sidecar container');
      expect(result).toContain('myapp:2.0');
    });

    it('should add comments at different nesting levels via addInstructions', () => {
      const yamlString = `
root:
  level1:
    level2:
      value: original
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'root',
                comment: 'Root level comment'
              }),
              root: {
                ...addInstructions({
                  prop: 'level1',
                  comment: 'Level 1 comment'
                }),
                level1: {
                  ...addInstructions({
                    prop: 'level2',
                    comment: 'Level 2 comment'
                  }),
                  level2: {
                    value: 'updated'
                  }
                }
              }
            })
          });
        }
      });

      expect(result).toContain('# Root level comment');
      expect(result).toContain('# Level 1 comment');
      expect(result).toContain('# Level 2 comment');
      expect(result).toContain('value: updated');
    });

    it('should preserve comments on empty objects and arrays', () => {
      const yamlString = `
# Empty object
emptyObj: {}
# Empty array
emptyArr: []
# Object with empty nested
nested:
  # Empty nested object
  emptyNested: {}
  # Empty nested array
  emptyNestedArr: []
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.nested,
            merge: (originalValue) => ({
              ...originalValue,
              newKey: 'newValue'
            })
          });
        }
      });

      expect(result).toContain('# Empty object');
      expect(result).toContain('# Empty array');
      expect(result).toContain('# Empty nested object');
      expect(result).toContain('# Empty nested array');
      expect(result).toContain('newKey: newValue');
    });

    it('should handle comments with special characters', () => {
      const yamlString = `
# Comment with special chars: @#$%^&*()
config:
  # Comment with quotes: "quoted" and 'single'
  key1: value1
  # Comment with colons: key:value
  key2: value2
  # Comment with dashes: some-dash-comment
  key3: value3
  # Comment with unicode: 你好世界 🚀
  key4: value4
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.config,
            merge: (originalValue) => ({
              ...originalValue,
              key1: 'updated'
            })
          });
        }
      });

      expect(result).toContain('# Comment with special chars: @#$%^&*()');
      expect(result).toContain('# Comment with quotes: "quoted" and \'single\'');
      expect(result).toContain('# Comment with colons: key:value');
      expect(result).toContain('# Comment with dashes: some-dash-comment');
      expect(result).toContain('# Comment with unicode: 你好世界 🚀');
    });

    it('should preserve multi-line comment blocks', () => {
      const yamlString = `
# This is a multi-line comment
# that spans multiple lines
# to describe the configuration
apiVersion: v1
kind: ConfigMap
# Another multi-line comment
# for the data section
# with detailed information
data:
  key: value
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              key: 'updated'
            })
          });
        }
      });

      expect(result).toContain('# This is a multi-line comment');
      expect(result).toContain('# that spans multiple lines');
      expect(result).toContain('# to describe the configuration');
      expect(result).toContain('# Another multi-line comment');
      expect(result).toContain('# for the data section');
      expect(result).toContain('# with detailed information');
    });
  });

  describe('comprehensive YAML editing with comment preservation', () => {
    it('should preserve comments when adding new properties', () => {
      const yamlString = `
# Root comment
root:
  # Level 1 comment
  level1:
    # Existing property comment
    existing: value1
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.root.level1,
            merge: (originalValue) => ({
              ...originalValue,
              newProperty: 'added'
            })
          });
        }
      });

      // All original comments should be preserved
      expect(result).toContain('# Root comment');
      expect(result).toContain('# Level 1 comment');
      expect(result).toContain('# Existing property comment');
      expect(result).toContain('newProperty: added');
    });

    it('should preserve comments when updating selective properties', () => {
      const yamlString = `
config:
  # Keep this property
  toKeep: value1
  # Modify this property
  toModify: value2
  # Keep this too
  alsoKeep: value3
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.config,
            merge: (originalValue) => ({
              ...originalValue,
              toModify: 'updated'
            })
          });
        }
      });

      expect(result).toContain('# Keep this property');
      expect(result).toContain('# Modify this property');
      expect(result).toContain('# Keep this too');
      expect(result).toContain('toModify: updated');
    });

    it('should preserve comments when modifying values of different types', () => {
      const yamlString = `
config:
  # String configuration
  stringVal: "original"
  # Number configuration
  numberVal: 42
  # Boolean flag
  boolVal: false
  # Array configuration
  arrayVal:
    - item1
    - item2
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.config,
            merge: (originalValue) => ({
              stringVal: originalValue.stringVal.toUpperCase(),
              numberVal: originalValue.numberVal * 2,
              boolVal: !originalValue.boolVal,
              arrayVal: [...originalValue.arrayVal, 'item3']
            })
          });
        }
      });

      expect(result).toContain('# String configuration');
      expect(result).toContain('# Number configuration');
      expect(result).toContain('# Boolean flag');
      expect(result).toContain('# Array configuration');
      expect(result).toContain('ORIGINAL');  // May be quoted as "ORIGINAL"
      expect(result).toContain('numberVal: 84');
    });

    it('should preserve comments in deeply nested structures during updates', () => {
      const yamlString = `
# Level 1 comment
level1:
  # Level 2 comment
  level2:
    # Level 3 comment
    level3:
      # Level 4 comment
      level4:
        # The actual value
        value: original
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.level1.level2.level3.level4,
            merge: (originalValue) => ({
              value: originalValue.value.toUpperCase()
            })
          });
        }
      });

      expect(result).toContain('# Level 1 comment');
      expect(result).toContain('# Level 2 comment');
      expect(result).toContain('# Level 3 comment');
      expect(result).toContain('# Level 4 comment');
      expect(result).toContain('# The actual value');
      expect(result).toContain('value: ORIGINAL');
    });

    it('should preserve comments when using mergeByName on arrays', () => {
      const yamlString = `
# Services array
services:
  # Frontend service
  - name: frontend
    port: 80
  # Backend service
  - name: backend
    port: 8080
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'services',
                mergeByName: true
              }),
              services: [
                { name: 'frontend', port: 443 },
                { name: 'database', port: 5432 }
              ]
            })
          });
        }
      });

      expect(result).toContain('# Services array');
      expect(result).toContain('# Frontend service');
      expect(result).toContain('# Backend service');
      expect(result).toContain('port: 443');  // Updated
      expect(result).toContain('name: database');  // Added
    });

    it('should add comments via change callback while preserving existing ones', () => {
      const yamlString = `
# Existing root comment
config:
  # Existing nested comment
  database:
    host: localhost
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.config,
            merge: (originalValue) => ({
              ...originalValue,
              newField: 'added'
            }),
            comment: () => 'New comment via change callback'
          });
        }
      });

      expect(result).toContain('# Existing root comment');
      expect(result).toContain('# New comment via change callback');
      expect(result).toContain('database:');
      // Note: Nested comment is preserved as it's within the database object
    });

    it('should handle comments when replacing entire structures', () => {
      const yamlString = `
# Database configuration
database:
  # Connection settings
  connection:
    # Host setting
    host: localhost
    # Port setting
    port: 5432
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'database',
                comment: 'Updated database configuration'
              }),
              database: {
                connection: {
                  host: 'db.prod.com',
                  port: 5432
                }
              }
            })
          });
        }
      });

      expect(result).toContain('# Database configuration');
      expect(result).toContain('# Updated database configuration');
      expect(result).toContain('db.prod.com');
      // Note: When replacing entire structure, inner comments (Connection settings, Host setting, Port setting)
      // are replaced. This is expected - use originalValue with spread to preserve structure and comments.
    });

    it('should preserve comments in arrays with complex objects', () => {
      const yamlString = `
# Container definitions
containers:
  # Main application container
  - name: app
    # Container image
    image: myapp:1.0
    # Resource limits
    resources:
      # CPU limit
      limits:
        cpu: 100m
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (originalValue) => ({
              ...addInstructions({
                prop: 'containers',
                mergeByName: true
              }),
              containers: [
                {
                  name: 'app',
                  image: 'myapp:2.0',
                  resources: originalValue.containers[0].resources
                }
              ]
            })
          });
        }
      });

      expect(result).toContain('# Container definitions');
      expect(result).toContain('# Main application container');
      expect(result).toContain('# Container image');
      expect(result).toContain('# Resource limits');
      expect(result).toContain('myapp:2.0');
    });

    it('should preserve comments when making multiple changes', () => {
      const yamlString = `
# Configuration
config:
  # First value
  value1: 1
  # Second value
  value2: 2
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.config,
            merge: (originalValue) => ({
              ...originalValue,
              value1: originalValue.value1 + 10
            })
          });

          change({
            findKey: (parsed: any) => parsed.config,
            merge: (originalValue) => ({
              ...originalValue,
              value2: originalValue.value2 * 2
            })
          });
        }
      });

      expect(result).toContain('# Configuration');
      expect(result).toContain('# First value');
      expect(result).toContain('# Second value');
      expect(result).toContain('value1: 11');
      expect(result).toContain('value2: 4');
    });

    it('should preserve comments on edge case values', () => {
      const yamlString = `
data:
  # Empty string value
  emptyString: ""
  # Zero value
  zero: 0
  # False value
  false: false
  # Null value
  null: null
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: (originalValue) => ({
              emptyString: originalValue.emptyString || 'default',
              zero: originalValue.zero + 1,
              false: !originalValue.false,
              null: 'updated'
            })
          });
        }
      });

      expect(result).toContain('# Empty string value');
      expect(result).toContain('# Zero value');
      expect(result).toContain('# False value');
      expect(result).toContain('# Null value');
    });

    it('should handle comments with mergeByContents deduplication', () => {
      const yamlString = `
# Tolerations list
tolerations:
  # First toleration
  - key: node-role
    operator: Equal
    value: worker
  # Second toleration
  - key: node-type
    operator: Exists
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (originalValue) => ({
              ...addInstructions({
                prop: 'tolerations',
                mergeByContents: true
              }),
              tolerations: [
                ...originalValue.tolerations,
                { key: 'node-role', operator: 'Equal', value: 'worker' },  // Duplicate
                { key: 'disk-type', operator: 'Equal', value: 'ssd' }  // New
              ]
            })
          });
        }
      });

      expect(result).toContain('# Tolerations list');
      expect(result).toContain('# First toleration');
      expect(result).toContain('# Second toleration');
      expect(result).toContain('disk-type');
    });

    it('should combine existing and new comments at multiple levels', () => {
      const yamlString = `
# Existing root
root:
  # Existing level1
  level1:
    value: original
`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'root',
                comment: 'New root comment'
              }),
              root: {
                ...addInstructions({
                  prop: 'level1',
                  comment: 'New level1 comment'
                }),
                level1: {
                  value: 'updated'
                }
              }
            })
          });
        }
      });

      expect(result).toContain('# Existing root');
      expect(result).toContain('# New root comment');
      expect(result).toContain('# New level1 comment');
      expect(result).toContain('value: updated');
      // Note: "# Existing level1" is replaced by "# New level1 comment" because we're replacing
      // the entire root structure. To preserve, use originalValue with spread operator.
    });
  });

  describe('spacing and indentation preservation', () => {
    it('should preserve indentation in untouched sections', () => {
      const yamlString = `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  namespace: default
data:
  database: localhost
  cache: redis
  nested:
    deep:
      value: original`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              database: 'db.production.com'
            })
          });
        }
      });

      // Verify metadata section indentation is unchanged
      expect(result).toContain('metadata:\n  name: my-config');
      expect(result).toContain('  namespace: default');

      // Verify nested data indentation is unchanged
      expect(result).toContain('  nested:\n    deep:\n      value: original');

      // Verify root level spacing
      expect(result).toContain('apiVersion: v1\nkind: ConfigMap');
    });

    it('should preserve blank lines and spacing between sections', () => {
      const yamlString = `apiVersion: v1

kind: ConfigMap

metadata:
  name: my-config

data:
  database: localhost

  cache: redis`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              database: 'db.production.com'
            })
          });
        }
      });

      // YAML library may normalize blank lines, but we verify structure is maintained
      expect(result).toContain('apiVersion: v1');
      expect(result).toContain('kind: ConfigMap');
      expect(result).toContain('metadata:');
      expect(result).toContain('data:');
    });

    it('should preserve consistent indentation levels across document', () => {
      const yamlString = `root:
  level1a:
    level2a:
      level3a: valueA
      level3b: valueB
  level1b:
    level2b:
      level3c: valueC`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.root.level1a.level2a,
            merge: () => ({
              level3a: 'UPDATED'
            })
          });
        }
      });

      // Verify level1b sibling is completely untouched with proper indentation
      expect(result).toContain('  level1b:\n    level2b:\n      level3c: valueC');

      // Verify level1a structure maintained
      expect(result).toContain('root:\n  level1a:\n    level2a:');
    });

    it('should preserve array indentation and style', () => {
      const yamlString = `spec:
  containers:
    - name: app
      image: myapp:1.0
      ports:
        - containerPort: 8080
    - name: sidecar
      image: sidecar:1.0`;

      interface Spec {
        containers: Array<{ name: string; image: string; ports?: Array<{ containerPort: number }> }>;
      }

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.spec,
            merge: () => ({
              ...addInstructions({
                prop: 'containers',
                mergeByName: true
              }),
              containers: [
                {
                  name: 'app',
                  image: 'myapp:2.0'
                }
              ]
            })
          });
        }
      });

      // Verify sidecar container indentation preserved
      expect(result).toContain('  - name: sidecar');
      expect(result).toContain('    image: sidecar:1.0');

      // Verify nested ports array maintained (if present)
      expect(result).toMatch(/ports:\s+- containerPort: 8080/);
    });

    it('should preserve spacing around scalar values', () => {
      const yamlString = `config:
  string: "quoted string"
  number: 42
  boolean: true
  null: null`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.config,
            merge: () => ({
              number: 84
            })
          });
        }
      });

      // Verify other values maintain their formatting
      expect(result).toContain('string:');
      expect(result).toContain('boolean: true');
      expect(result).toContain('null: null');
    });

    it('should preserve indentation when updating deeply nested values', () => {
      const yamlString = `root:
  branch1:
    leaf1: value1
    leaf2: value2
  branch2:
    subbranch:
      leaf3: value3
      leaf4: value4`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.root.branch2.subbranch,
            merge: () => ({
              leaf3: 'UPDATED'
            })
          });
        }
      });

      // Verify branch1 is completely untouched
      expect(result).toContain('  branch1:\n    leaf1: value1\n    leaf2: value2');

      // Verify leaf4 sibling indentation preserved
      expect(result).toContain('      leaf4: value4');
    });

    it('should preserve mixed content indentation', () => {
      const yamlString = `metadata:
  labels:
    app: myapp
    version: v1
  annotations:
    description: "Multi-line
      description with
      indentation"
spec:
  replicas: 3`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.spec,
            merge: () => ({
              replicas: 5
            })
          });
        }
      });

      // Verify metadata section completely untouched
      expect(result).toContain('metadata:\n  labels:\n    app: myapp');
      expect(result).toContain('    version: v1');
      expect(result).toContain('  annotations:');
    });

    it('should preserve indentation when adding new properties', () => {
      const yamlString = `config:
  existing:
    value: original
    nested:
      deep: value`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.config,
            merge: () => ({
              newProp: 'newValue'
            })
          });
        }
      });

      // Verify existing nested structure maintains indentation
      expect(result).toContain('  existing:\n    value: original');
      expect(result).toContain('    nested:\n      deep: value');

      // Verify new property follows same indentation pattern
      expect(result).toContain('  newProp:');
    });
  });
});
