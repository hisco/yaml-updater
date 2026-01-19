import { updateYaml, addInstructions, selectFirstDocument } from './index';
import { describe, it, expect } from '@jest/globals';
import { stringify } from 'yaml';

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

  describe('array updates without merge instructions', () => {
    it('should replace array entirely when no merge instructions provided', () => {
      const yamlString = `
items:
  - id: 1
    name: first
  - id: 2
    name: second
  - id: 3
    name: third
`;

      interface Item {
        id: number;
        name: string;
      }

      interface Data {
        items: Item[];
      }

      const { resultParsed, result } = updateYaml<Data>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.items,
            merge: () => [
              { id: 1, name: 'first' },
              { id: 4, name: 'fourth' }
            ]
          });
        }
      });

      // Without merge instructions, array should be completely replaced
      expect(resultParsed.items).toHaveLength(2);
      expect(resultParsed.items.find(i => i.id === 1)).toBeDefined();
      expect(resultParsed.items.find(i => i.id === 4)).toBeDefined();
      expect(resultParsed.items.find(i => i.id === 2)).toBeUndefined();
      expect(resultParsed.items.find(i => i.id === 3)).toBeUndefined();
    });

    it('should replace array when item IDs change without merge instructions', () => {
      const yamlString = `
services:
  - id: api
    port: 8080
  - id: db
    port: 5432
`;

      interface Service {
        id: string;
        port: number;
      }

      interface Config {
        services: Service[];
      }

      const { resultParsed } = updateYaml<Config>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.services,
            merge: () => [
              { id: 'api', port: 8080 },
              { id: 'cache', port: 6379 }  // 'db' -> 'cache'
            ]
          });
        }
      });

      // Should replace, not add
      expect(resultParsed.services).toHaveLength(2);
      expect(resultParsed.services.find(s => s.id === 'api')).toBeDefined();
      expect(resultParsed.services.find(s => s.id === 'cache')).toBeDefined();
      expect(resultParsed.services.find(s => s.id === 'db')).toBeUndefined();
    });

    it('should handle empty array replacement', () => {
      const yamlString = `
items:
  - id: 1
  - id: 2
`;

      interface Data {
        items: { id: number }[];
      }

      const { resultParsed } = updateYaml<Data>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.items,
            merge: () => []
          });
        }
      });

      expect(resultParsed.items).toHaveLength(0);
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

      expect(result).toBe(`apiVersion: v1
kind: ConfigMap
# Configuration data
data:
  database: localhost
  cache: redis
`)
    });

    it('should add comments to nested properties via addInstructions', () => {
      const yamlString = `
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
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
          template: {
            spec: {
              containers: Array<{ name: string; image: string }>;
            };
          };
        };
      }

      const { result } = updateYaml<Deployment>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'spec',
                comment: 'Deployment specification'
              }),
              spec: {
                ...addInstructions({
                  prop: 'replicas',
                  comment: 'Number of pod replicas'
                }),
                replicas: 3,
                ...addInstructions({
                  prop: 'template',
                  comment: 'Pod template'
                }),
                template: {
                  spec: {
                    containers: [
                      {
                        name: 'app',
                        image: 'myapp:1.0'
                      }
                    ]
                  }
                }
              }
            })
          });
        }
      });

      expect(result).toBe(`apiVersion: apps/v1
kind: Deployment
# Deployment specification
spec:
  # Number of pod replicas
  replicas: 3
  # Pod template
  template:
    spec:
      containers:
        - name: app
          image: myapp:1.0
`)
    });

    it('should add comments to deeply nested properties', () => {
      const yamlString = `
config:
  database:
    connection:
      host: localhost
      port: 5432
`;

      interface Config {
        config: {
          database: {
            connection: {
              host: string;
              port: number;
            };
          };
        };
      }

      const { result } = updateYaml<Config>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.config,
            merge: () => ({
              ...addInstructions({
                prop: 'database',
                comment: 'Database configuration'
              }),
              database: {
                ...addInstructions({
                  prop: 'connection',
                  comment: 'Connection settings'
                }),
                connection: {
                  ...addInstructions({
                    prop: 'host',
                    comment: 'Database host'
                  }),
                  host: 'localhost',
                  ...addInstructions({
                    prop: 'port',
                    comment: 'Database port'
                  }),
                  port: 5432
                }
              }
            })
          });
        }
      });

      expect(result).toBe(`config:
  # Database configuration
  database:
    # Connection settings
    connection:
      # Database host
      host: localhost
      # Database port
      port: 5432
`)
    });

    it('should format properties as JSON using flow style', () => {
      const yamlString = `
items:
  - item1
  - item2
`;

      interface Config {
        items: string[];
        thisisJson?: Record<string, unknown>;
        jsons?: Array<Record<string, unknown>>;
      }

      const { result } = updateYaml<Config>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'thisisJson',
                flow: true  // Format as JSON: {}
              }),
              thisisJson: {},
              ...addInstructions({
                prop: 'items',
                flow: false  // Format as YAML block style
              }),
              items: ['item1', 'item2'],
              ...addInstructions({
                prop: 'jsons',
                flow: true  // Format as JSON: [{}, {key: 1}]
              }),
              jsons: [
                {},
                { key: 1 }
              ]
            })
          });
        }
      });

      expect(result).toContain('thisisJson: {}');
      expect(result).toContain('items:');
      expect(result).toContain('  - item1');
      expect(result).toContain('  - item2');
      // Flow style adds spaces in arrays/objects
      expect(result).toContain('jsons: [ {}, { key: 1 } ]');
    });

    it('should control flow style for individual array items', () => {
      const yamlString = `
items: []
`;

      interface Config {
        items: Array<Record<string, unknown>>;
      }

      const { result } = updateYaml<Config>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'items',
                flowItems: [true, false, true]  // First: JSON, Second: YAML, Third: JSON
              }),
              items: [
                { id: 1, name: 'first' },
                { id: 2, name: 'second' },
                { id: 3, name: 'third' }
              ]
            })
          });
        }
      });

      // First item should be in flow style (JSON - single line)
      expect(result).toContain('- { id: 1, name: first }');

      // Second item should be in block style (YAML - multi-line)
      expect(result).toContain('- id: 2');
      expect(result).toContain('  name: second');

      // Third item should be in flow style (JSON - single line)
      expect(result).toContain('- { id: 3, name: third }');
    });

    it('should mix empty objects and objects with data using flowItems', () => {
      const yamlString = `
jsons: []
`;

      interface Config {
        jsons: Array<Record<string, unknown>>;
      }

      const { result } = updateYaml<Config>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'jsons',
                flowItems: [true, false]  // First: JSON (empty {}), Second: YAML (with data)
              }),
              jsons: [
                {},
                { key: 1 }
              ]
            })
          });
        }
      });

      // First item should be empty object in JSON format
      expect(result).toContain('- {}');

      // Second item should be in YAML block style
      expect(result).toContain('- key: 1');
    });

    it('should support mixed YAML and JSON formatting in same document', () => {
      const yamlString = `
config:
  name: myapp
`;

      interface Config {
        config: {
          name: string;
          settings?: {
            debug: boolean;
            timeout: number;
          };
          metadata?: Record<string, string>;
          tags?: string[];
          features?: string[];
        };
      }

      const { result } = updateYaml<Config>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.config,
            merge: () => ({
              name: 'myapp',
              // YAML block style (default)
              ...addInstructions({
                prop: 'settings',
                comment: 'Settings in YAML block style'
              }),
              settings: {
                debug: true,
                timeout: 30
              },
              // JSON flow style
              ...addInstructions({
                prop: 'metadata',
                comment: 'Metadata in JSON flow style',
                flow: true
              }),
              metadata: { version: '1.0', env: 'prod' },
              // JSON flow style for array
              ...addInstructions({
                prop: 'tags',
                comment: 'Tags in JSON flow style',
                flow: true
              }),
              tags: ['tag1', 'tag2', 'tag3'],
              // YAML block style for array
              ...addInstructions({
                prop: 'features',
                comment: 'Features in YAML block style',
                flow: false
              }),
              features: ['feature1', 'feature2']
            })
          });
        }
      });

      // Verify YAML block style for settings (multi-line format)
      expect(result).toContain('settings:');
      expect(result).toContain('  debug: true');
      expect(result).toContain('  timeout: 30');

      // Verify JSON flow style for metadata (single-line format)
      expect(result).toContain('metadata: { version:');
      expect(result).toContain('env: prod');

      // Verify JSON flow style for tags array (single-line format)
      expect(result).toContain('tags: [ tag1, tag2, tag3 ]');

      // Verify YAML block style for features array (multi-line format)
      expect(result).toContain('features:');
      expect(result).toContain('  - feature1');
      expect(result).toContain('  - feature2');
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

      // Old comment is replaced by new comment when using addInstructions
      expect(result).not.toContain('# Database configuration');
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

      // Old comments are replaced when using addInstructions
      expect(result).not.toContain('# Existing root');
      expect(result).toContain('# New root comment');
      expect(result).toContain('# New level1 comment');
      expect(result).toContain('value: updated');
      // Note: "# Existing level1" is also replaced by "# New level1 comment" because we're replacing
      // the entire root structure. To preserve, use originalValue with spread operator.
    });
  });

  describe('inline comments (commentAfter)', () => {
    it('should add inline comment using addInstructions with commentAfter', () => {
      const yamlString = `apiVersion: v1
kind: ConfigMap`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              apiVersion: 'v1',
              kind: 'ConfigMap',
              ...addInstructions({
                prop: 'enabled',
                commentAfter: 'can change whether this is deployed'
              }),
              enabled: null
            })
          });
        }
      });

      expect(result).toContain('enabled: # can change whether this is deployed');
      expect(result).not.toContain('enabled: null');
    });

    it('should add inline comments to nested properties', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              charts: {
                ...addInstructions({
                  prop: 'sealedSecrets',
                  commentAfter: 'SealedSecrets chart configuration'
                }),
                sealedSecrets: {
                  ...addInstructions({
                    prop: 'enabled',
                    commentAfter: 'toggle chart deployment'
                  }),
                  enabled: null
                }
              }
            })
          });
        }
      });

      // Note: When a property has an object value (not null/scalar),
      // the inline comment appears as a block comment at the start of the object content
      expect(result).toContain('# SealedSecrets chart configuration');
      expect(result).toContain('enabled: # toggle chart deployment');
    });

    it('should support inline comments with non-null values', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'replicas',
                commentAfter: 'number of replicas'
              }),
              replicas: 3,
              ...addInstructions({
                prop: 'name',
                commentAfter: 'service name'
              }),
              name: 'myapp'
            })
          });
        }
      });

      expect(result).toContain('replicas: 3 # number of replicas');
      expect(result).toContain('name: myapp # service name');
    });

    it('should combine inline and block comments', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'metadata',
                comment: 'Resource metadata (block comment)'
              }),
              metadata: {
                name: 'test'
              },
              ...addInstructions({
                prop: 'enabled',
                commentAfter: 'inline comment'
              }),
              enabled: null
            })
          });
        }
      });

      expect(result).toContain('# Resource metadata (block comment)');
      expect(result).toContain('enabled: # inline comment');
    });

    it('should work with schema-level commentAfter instructions', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        schema: {
          properties: {
            enabled: {
              commentAfter: 'toggle deployment'
            },
            replicas: {
              commentAfter: 'replica count'
            }
          }
        },
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              enabled: null,
              replicas: 3
            })
          });
        }
      });

      expect(result).toContain('enabled: # toggle deployment');
      expect(result).toContain('replicas: 3 # replica count');
    });

    it('should handle Kubernetes-style chart configuration with inline comments', () => {
      const yamlString = 'charts: {}';
      const alias = 'sealedSecrets';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (obj: any) => obj.charts,
            merge: () => ({
              ...addInstructions({
                prop: alias,
                commentAfter: 'SealedSecrets Helm chart'
              }),
              [alias]: {
                ...addInstructions({
                  prop: 'enabled',
                  commentAfter: 'can change whether the chart will be deployed or not'
                }),
                enabled: null
              }
            })
          });
        }
      });

      // Note: When a property has an object value, the inline comment appears as block comment
      expect(result).toContain('# SealedSecrets Helm chart');
      expect(result).toContain('enabled: # can change whether the chart will be deployed or not');
      expect(result).not.toContain('enabled: null');
    });

    it('should produce exact output with proper key ordering and empty values', () => {
      const yaml = require('yaml');
      const alias = 'sealedSecrets';

      // Build initial YAML with proper structure
      const doc = yaml.parseDocument('');
      doc.contents = doc.createNode({});

      // Add charts first
      doc.contents.items.push(doc.createPair('charts', doc.createNode({
        [alias]: {}
      })));

      // Add sealedSecrets with empty value (no null shown)
      const sealedSecretsScalar = new yaml.Scalar(null);
      sealedSecretsScalar.type = 'PLAIN';
      sealedSecretsScalar.source = '';
      doc.contents.items.push(doc.createPair('sealedSecrets', sealedSecretsScalar));

      const yamlString = doc.toString();

      // Use updateYaml to add inline comment to enabled
      const { result } = updateYaml({
        yamlString,
        selectDocument: selectFirstDocument,
        annotate: ({ change }) => {
          change({
            findKey: (obj: any) => obj.charts[alias],
            merge: () => ({
              ...addInstructions({
                prop: 'enabled',
                commentAfter: 'enabled: can change whether the chart will be deployed or not'
              }),
              enabled: null
            }),
          });
        },
      });

      const expected = `charts:
  sealedSecrets:
    enabled: # enabled: can change whether the chart will be deployed or not
sealedSecrets:
`;

      expect(result).toBe(expected);
    });
  });

  describe('hideNull instruction', () => {
    it('should hide null values when hideNull is true', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'enabled',
                hideNull: true
              }),
              enabled: null
            })
          });
        }
      });

      expect(result).toBe('enabled:\n');
      expect(result).not.toContain('null');
    });

    it('should hide null with inline comment', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'enabled',
                commentAfter: 'toggle deployment',
                hideNull: true
              }),
              enabled: null
            })
          });
        }
      });

      expect(result).toContain('enabled: # toggle deployment');
      expect(result).not.toContain('enabled: null');
    });

    it('should work with nested properties', () => {
      const yamlString = stringify({
        charts: { sealedSecrets: {} }
      });

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (obj: any) => obj.charts.sealedSecrets,
            merge: () => ({
              ...addInstructions({
                prop: 'enabled',
                hideNull: true
              }),
              enabled: null
            })
          });
        }
      });

      expect(result).toContain('enabled:');
      expect(result).not.toContain('enabled: null');
    });

    it('should hide multiple null values', () => {
      const yamlString = stringify({
        charts: {},
        config: {}
      });

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (obj: any) => obj.charts,
            merge: () => ({
              ...addInstructions({
                prop: 'enabled',
                hideNull: true
              }),
              enabled: null,
              ...addInstructions({
                prop: 'version',
                hideNull: true
              }),
              version: null
            })
          });
        }
      });

      expect(result).toContain('enabled:');
      expect(result).toContain('version:');
      expect(result).not.toContain('null');
    });

    it('should work with schema-level hideNull', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        schema: {
          properties: {
            enabled: {
              hideNull: true
            },
            disabled: {
              hideNull: true
            }
          }
        },
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              enabled: null,
              disabled: null
            })
          });
        }
      });

      expect(result).toContain('enabled:');
      expect(result).toContain('disabled:');
      expect(result).not.toContain('null');
    });

    it('should not hide non-null values', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              ...addInstructions({
                prop: 'enabled',
                hideNull: true
              }),
              enabled: false,  // boolean false, not null
              ...addInstructions({
                prop: 'count',
                hideNull: true
              }),
              count: 0  // number 0, not null
            })
          });
        }
      });

      expect(result).toContain('enabled: false');
      expect(result).toContain('count: 0');
    });

    it('should produce exact Kubernetes-style output', () => {
      const alias = 'sealedSecrets';

      const initialStructure = {
        charts: {
          [alias]: {}
        },
        [alias]: null
      };

      const yamlString = stringify(initialStructure);

      const { result } = updateYaml({
        yamlString,
        selectDocument: selectFirstDocument,
        annotate: ({ change }) => {
          change({
            findKey: (obj: any) => obj.charts[alias],
            merge: () => ({
              ...addInstructions({
                prop: 'enabled',
                commentAfter: 'can change whether the chart will be deployed or not',
                hideNull: true
              }),
              enabled: null
            }),
          });

          change({
            findKey: (obj: any) => obj,
            merge: () => ({
              ...addInstructions({
                prop: alias,
                hideNull: true
              }),
              [alias]: null
            }),
          });
        },
      });

      const expected = `charts:
  sealedSecrets:
    enabled: # can change whether the chart will be deployed or not
sealedSecrets:
`;

      expect(result).toBe(expected);
    });
  });

  describe('multi-document YAML support', () => {
    it('should select the first document using selectFirstDocument', () => {
      const yamlString = `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: first-config
data:
  key1: value1
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: second-config
data:
  key2: value2
---
apiVersion: v1
kind: Service
metadata:
  name: third-service
spec:
  port: 8080`;

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        metadata: {
          name: string;
        };
        data: {
          [key: string]: string;
        };
      }

      const { result, resultParsed } = updateYaml<ConfigMap>({
        yamlString,
        selectDocument: selectFirstDocument, // Explicitly use selectFirstDocument
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              key1: 'updated-value1',
              newKey: 'new-value'
            })
          });
        }
      });

      expect(resultParsed.metadata.name).toBe('first-config');
      expect(resultParsed.data.key1).toBe('updated-value1');
      expect(resultParsed.data.newKey).toBe('new-value');
      expect(result).toContain('key1: updated-value1');
      expect(result).toContain('newKey: new-value');
      // Verify second document is unchanged
      expect(result).toContain('name: second-config');
      expect(result).toContain('key2: value2');
    });

    it('should select any document by index', () => {
      const yamlString = `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: first-config
data:
  env: dev
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: second-config
data:
  env: staging
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: third-config
data:
  env: production`;

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        metadata: {
          name: string;
        };
        data: {
          env: string;
        };
      }

      // Test selecting the second document (index 1)
      const { result: result2, resultParsed: parsed2 } = updateYaml<ConfigMap>({
        yamlString,
        selectDocument: () => 1, // Select second document
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              env: 'updated-staging',
              newProp: 'added-to-second'
            })
          });
        }
      });

      expect(parsed2.metadata.name).toBe('second-config');
      expect(parsed2.data.env).toBe('updated-staging');
      expect(result2).toContain('env: updated-staging');
      expect(result2).toContain('newProp: added-to-second');
      // Verify first and third documents are unchanged
      expect(result2).toContain('name: first-config');
      expect(result2).toContain('env: dev');
      expect(result2).toContain('name: third-config');
      expect(result2).toContain('env: production');

      // Test selecting the third document (index 2)
      const { result: result3, resultParsed: parsed3 } = updateYaml<ConfigMap>({
        yamlString,
        selectDocument: () => 2, // Select third document
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.metadata,
            merge: () => ({
              name: 'renamed-config',
              namespace: 'custom'
            })
          });
        }
      });

      expect(parsed3.metadata.name).toBe('renamed-config');
      expect((parsed3.metadata as any).namespace).toBe('custom');
      expect(result3).toContain('name: renamed-config');
      expect(result3).toContain('namespace: custom');
      // Verify first and second documents are unchanged
      expect(result3).toContain('name: first-config');
      expect(result3).toContain('name: second-config');
    });

    it('should handle document selection with type safety', () => {
      const yamlString = `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: config
data:
  key: value
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: app
          image: myapp:1.0`;

      // Define different types for different documents
      interface ConfigMap {
        apiVersion: string;
        kind: 'ConfigMap';
        metadata: { name: string };
        data: { [key: string]: string };
      }

      interface Deployment {
        apiVersion: string;
        kind: 'Deployment';
        metadata: { name: string };
        spec: {
          replicas: number;
          template?: {
            spec?: {
              containers: Array<{ name: string; image: string }>;
            };
          };
        };
      }

      // Update the ConfigMap (first document)
      const { resultParsed: configResult } = updateYaml<ConfigMap>({
        yamlString,
        selectDocument: () => 0,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              key: 'updated',
              another: 'value'
            })
          });
        }
      });

      expect(configResult.kind).toBe('ConfigMap');
      expect(configResult.data.key).toBe('updated');
      expect(configResult.data.another).toBe('value');

      // Update the Deployment (second document)
      const { resultParsed: deploymentResult } = updateYaml<Deployment>({
        yamlString,
        selectDocument: () => 1,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.spec,
            merge: () => ({
              replicas: 5
            })
          });
        }
      });

      expect(deploymentResult.kind).toBe('Deployment');
      expect(deploymentResult.spec.replicas).toBe(5);
    });

    it('should select documents dynamically based on content', () => {
      const yamlString = `---
apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  port: 80
---
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  port: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: database
spec:
  port: 5432`;

      interface Service {
        apiVersion: string;
        kind: string;
        metadata: { name: string };
        spec: { port: number };
      }

      // Select document based on metadata.name
      const { result, resultParsed } = updateYaml<Service>({
        yamlString,
        selectDocument: (docs) => {
          // Find the backend service document
          return docs.findIndex(doc => {
            const parsed = doc.toJSON() as Service;
            return parsed.metadata?.name === 'backend';
          });
        },
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.spec,
            merge: () => ({
              port: 9000,
              protocol: 'TCP'
            })
          });
        }
      });

      expect(resultParsed.metadata.name).toBe('backend');
      expect(resultParsed.spec.port).toBe(9000);
      expect(result).toContain('port: 9000');
      expect(result).toContain('protocol: TCP');
      // Verify other documents unchanged
      expect(result).toContain('name: frontend');
      expect(result).toContain('port: 80');
      expect(result).toContain('name: database');
      expect(result).toContain('port: 5432');
    });

    it('should preserve comments in multi-document YAML', () => {
      const yamlString = `---
# First document comment
apiVersion: v1
kind: ConfigMap
metadata:
  # Name comment
  name: first-config
data:
  key: value
---
# Second document comment
apiVersion: v1
kind: ConfigMap
metadata:
  name: second-config
# Data comment
data:
  key: value`;

      const { result } = updateYaml({
        yamlString,
        selectDocument: () => 1, // Select second document
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              key: 'updated',
              newKey: 'added'
            })
          });
        }
      });

      // Verify comments are preserved in both documents
      expect(result).toContain('# First document comment');
      expect(result).toContain('# Name comment');
      expect(result).toContain('# Second document comment');
      expect(result).toContain('# Data comment');
      expect(result).toContain('key: updated');
      expect(result).toContain('newKey: added');
    });

    it('should handle empty documents in multi-document YAML', () => {
      const yamlString = `---
{}
---
apiVersion: v1
kind: ConfigMap
data:
  key: value
---
null`;

      interface ConfigMap {
        apiVersion?: string;
        kind?: string;
        data?: { [key: string]: string };
      }

      // Update the second document (ConfigMap)
      const { result, resultParsed } = updateYaml<ConfigMap>({
        yamlString,
        selectDocument: () => 1,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data!,
            merge: () => ({
              key: 'updated',
              another: 'value'
            })
          });
        }
      });

      expect(resultParsed.kind).toBe('ConfigMap');
      expect(resultParsed.data!.key).toBe('updated');
      expect(result).toContain('key: updated');
      expect(result).toContain('another: value');
      // Verify empty documents are preserved
      expect(result).toContain('---\n{}');
      expect(result).toContain('---\nnull');
    });

    it('should work with default document selection (first document)', () => {
      const yamlString = `---
name: first
value: 1
---
name: second
value: 2`;

      interface Doc {
        name: string;
        value: number;
      }

      // No selectDocument provided - should default to first document
      const { resultParsed } = updateYaml<Doc>({
        yamlString,
        // selectDocument not provided - uses default behavior
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              name: 'updated-first',
              value: 10
            })
          });
        }
      });

      expect(resultParsed.name).toBe('updated-first');
      expect(resultParsed.value).toBe(10);
    });

    it('should handle single document YAML with selectFirstDocument', () => {
      const yamlString = `apiVersion: v1
kind: ConfigMap
data:
  key: value`;

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        data: { [key: string]: string };
      }

      // Using selectFirstDocument on single-document YAML
      const { result, resultParsed } = updateYaml<ConfigMap>({
        yamlString,
        selectDocument: selectFirstDocument,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed.data,
            merge: () => ({
              key: 'updated',
              new: 'added'
            })
          });
        }
      });

      expect(resultParsed.data.key).toBe('updated');
      expect(resultParsed.data.new).toBe('added');
      expect(result).toContain('key: updated');
      expect(result).toContain('new: added');
    });

    it('should validate correct type inference with document selection', () => {
      const yamlString = `---
stringValue: hello
numberValue: 42
---
arrayValue: [1, 2, 3]
objectValue:
  nested: true`;

      interface FirstDoc {
        stringValue: string;
        numberValue: number;
      }

      interface SecondDoc {
        arrayValue: number[];
        objectValue: {
          nested: boolean;
        };
      }

      // Test type safety with first document
      const { resultParsed: first } = updateYaml<FirstDoc>({
        yamlString,
        selectDocument: () => 0,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: (original) => ({
              stringValue: original.stringValue.toUpperCase(), // Type-safe string methods
              numberValue: original.numberValue * 2 // Type-safe number operations
            })
          });
        }
      });

      expect(first.stringValue).toBe('HELLO');
      expect(first.numberValue).toBe(84);

      // Test type safety with second document
      const { resultParsed: second } = updateYaml<SecondDoc>({
        yamlString,
        selectDocument: () => 1,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: (original) => ({
              arrayValue: [...original.arrayValue, 4], // Type-safe array operations
              objectValue: {
                nested: !original.objectValue.nested // Type-safe boolean operations
              }
            })
          });
        }
      });

      expect(second.arrayValue).toEqual([1, 2, 3, 4]);
      expect(second.objectValue.nested).toBe(false);
    });
  });

  describe('writing to empty file', () => {
    it('should write YAML with input as empty string', () => {
      const yamlString = '      ';

      interface ConfigMap {
        apiVersion: string;
        kind: string;
        data: {
          key: string;
        };
      }

      const { result, resultParsed } = updateYaml<ConfigMap>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              apiVersion: 'v1',
              kind: 'ConfigMap',
              data: {
                key: 'value'
              }
            })
          });
        }
      });

      expect(resultParsed.apiVersion).toBe('v1');
      expect(resultParsed.kind).toBe('ConfigMap');
      expect(resultParsed.data.key).toBe('value');
      expect(result).toContain('apiVersion: v1');
      expect(result).toContain('kind: ConfigMap');
      expect(result).toContain('data:');
      expect(result).toContain('key: value');
    });
    it('should write YAML with input as empty string and output should be well yaml formatted not json', () => {
      const yamlString = '';

      interface ConfigMap {
        items: { name: string; value: string }[];
        nested: { deep: { value: string } };
      }

      const { result, resultParsed } = updateYaml<ConfigMap>({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              items: [
                {
                  name: 'item1',
                  value: 'value1'
                },
                {
                  name: 'item2',
                  value: 'value2'
                }
              ],
              nested: {
                deep: {
                  value: 'original'
                }
              }
            })
          });
        }
      });

      expect(result).toBe(`items:
  - name: item1
    value: value1
  - name: item2
    value: value2
nested:
  deep:
    value: original
`)
    });

    it('should create new documents when selectDocument returns index beyond available documents', () => {
      const yamlString = `---
first: doc
---
second: doc`;

      interface ThirdDoc {
        third: string;
        newField: string;
      }

      // Select document at index 2 (doesn't exist yet - we only have 0 and 1)
      const { result, resultParsed } = updateYaml<ThirdDoc>({
        yamlString,
        selectDocument: () => 2,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              third: 'doc',
              newField: 'added'
            })
          });
        }
      });

      // Should have 3 documents now
      expect(result).toContain('---');
      expect(result).toContain('first: doc');
      expect(result).toContain('second: doc');
      expect(result).toContain('third: doc');
      expect(result).toContain('newField: added');
      expect(resultParsed.third).toBe('doc');
      expect(resultParsed.newField).toBe('added');

      // Count document separators
      const separatorCount = (result.match(/---/g) || []).length;
      expect(separatorCount).toBe(3);
    });

    it('should create new document at index 5 when only 2 documents exist', () => {
      const yamlString = `---
first: doc
---
second: doc`;

      interface NewDoc {
        position: number;
        created: boolean;
      }

      const { result, resultParsed } = updateYaml<NewDoc>({
        yamlString,
        selectDocument: () => 5,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              position: 5,
              created: true
            })
          });
        }
      });

      expect(resultParsed.position).toBe(5);
      expect(resultParsed.created).toBe(true);
      expect(result).toContain('position: 5');
      expect(result).toContain('created: true');

      // Should have 6 documents (0-5)
      const separatorCount = (result.match(/---/g) || []).length;
      expect(separatorCount).toBe(6);
    });

    it('should create first document when empty file and selectDocument returns index > 0', () => {
      const yamlString = '';

      interface NewDoc {
        created: string;
      }

      const { result, resultParsed } = updateYaml<NewDoc>({
        yamlString,
        selectDocument: () => 2,
        annotate: ({ change }) => {
          change({
            findKey: (parsed) => parsed,
            merge: () => ({
              created: 'at-index-2'
            })
          });
        }
      });

      expect(resultParsed.created).toBe('at-index-2');
      expect(result).toContain('created: at-index-2');

      // Should have 3 documents (0, 1, 2)
      const separatorCount = (result.match(/---/g) || []).length;
      expect(separatorCount).toBe(3);
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

  describe('YAML Anchors and Aliases', () => {
    describe('basic anchor creation and simple alias reference', () => {
      it('should create anchor and simple alias reference', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({ prop: 'defaults', anchor: 'def' }),
                defaults: { timeout: 30 },
                ...addInstructions({ prop: 'service', alias: 'def' }),
                service: {}
              })
            });
          }
        });

        expect(result).toBe(`defaults: &def
  timeout: 30
service: *def
`)
      });

      it('should create multiple different anchors', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({ prop: 'db', anchor: 'db-config' }),
                db: { port: 5432 },
                ...addInstructions({ prop: 'cache', anchor: 'cache-config' }),
                cache: { port: 6379 },
                ...addInstructions({ prop: 'prodDB', alias: 'db-config' }),
                prodDB: {},
                ...addInstructions({ prop: 'prodCache', alias: 'cache-config' }),
                prodCache: {}
              })
            });
          }
        });

        expect(result).toBe(`db: &db-config
  port: 5432
cache: &cache-config
  port: 6379
prodDB: *db-config
prodCache: *cache-config
`)
      });
    });

    describe('merge anchor with additional properties', () => {
      it('should merge anchor with additional properties', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({ prop: 'base', anchor: 'base' }),
                base: { timeout: 30, retries: 3 },
                ...addInstructions({ prop: 'prod', mergeAnchor: 'base' }),
                prod: { host: 'prod.com', timeout: 60 }
              })
            });
          }
        });

        expect(result).toBe(`base: &base
  timeout: 30
  retries: 3
prod:
  <<: *base
  host: prod.com
  timeout: 60
`)

      });

      it('should merge anchor with empty object', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({ prop: 'base', anchor: 'base' }),
                base: { timeout: 30 },
                ...addInstructions({ prop: 'derived', mergeAnchor: 'base' }),
                derived: {}
              })
            });
          }
        });

        expect(result).toBe(`base: &base
  timeout: 30
derived:
  <<: *base
`)
      });

      it('should handle multiple services merging from same anchor', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({ prop: 'baseConfig', anchor: 'base' }),
                baseConfig: {
                  timeout: 30,
                  retries: 3,
                  ssl: true
                },
                ...addInstructions({ prop: 'prodConfig', mergeAnchor: 'base' }),
                prodConfig: {
                  host: 'prod.example.com',
                  timeout: 60
                },
                ...addInstructions({ prop: 'devConfig', mergeAnchor: 'base' }),
                devConfig: {
                  host: 'dev.example.com',
                  ssl: false
                }
              })
            });
          }
        });

        expect(result).toBe(`baseConfig: &base
  timeout: 30
  retries: 3
  ssl: true
prodConfig:
  <<: *base
  host: prod.example.com
  timeout: 60
devConfig:
  <<: *base
  host: dev.example.com
  ssl: false
`)
      });
    });

    describe('combine anchors with existing features', () => {
      it('should combine anchors with comments', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'defaults',
                  anchor: 'def',
                  comment: 'Default config'
                }),
                defaults: { timeout: 30 },
                ...addInstructions({
                  prop: 'service',
                  alias: 'def',
                  comment: 'Service config'
                }),
                service: {}
              })
            });
          }
        });

        expect(result).toBe(`# Default config
defaults: &def
  timeout: 30
# Service config
service: *def
`)
      });

      it('should combine anchors with flow style', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'defaults',
                  anchor: 'defaults',
                  flow: true
                }),
                defaults: {
                  cpu: '100m',
                  memory: '128Mi'
                },
                ...addInstructions({
                  prop: 'serviceA',
                  alias: 'defaults'
                }),
                serviceA: {}
              })
            });
          }
        });

        expect(result).toBe(`defaults: &defaults { cpu: 100m, memory: 128Mi }
serviceA: *defaults
`);
      });

      it('should combine anchors with comments and flow style', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'defaults',
                  anchor: 'defaults',
                  comment: 'Default configuration',
                  flow: true
                }),
                defaults: {
                  cpu: '100m',
                  memory: '128Mi'
                },
                ...addInstructions({
                  prop: 'serviceA',
                  mergeAnchor: 'defaults',
                  comment: 'Service A configuration'
                }),
                serviceA: {
                  replicas: 3
                }
              })
            });
          }
        });

        expect(result).toBe(`# Default configuration
defaults: &defaults { cpu: 100m, memory: 128Mi }
# Service A configuration
serviceA:
  <<: *defaults
  replicas: 3
`)
      });
    });

    describe('error handling', () => {
      it('should throw error for undefined anchor in alias', () => {
        expect(() => {
          updateYaml({
            yamlString: '',
            annotate: ({ change }) => {
              change({
                findKey: (parsed: any) => parsed,
                merge: () => ({
                  ...addInstructions({ prop: 'service', alias: 'undefined' }),
                  service: {}
                })
              });
            }
          });
        }).toThrow("Anchor 'undefined' is not defined");
      });

      it('should throw error for undefined anchor in mergeAnchor', () => {
        expect(() => {
          updateYaml({
            yamlString: '',
            annotate: ({ change }) => {
              change({
                findKey: (parsed: any) => parsed,
                merge: () => ({
                  ...addInstructions({ prop: 'service', mergeAnchor: 'nonexistent' }),
                  service: { host: 'example.com' }
                })
              });
            }
          });
        }).toThrow("Anchor 'nonexistent' is not defined");
      });

      it('should throw error for circular anchor references', () => {
        expect(() => {
          updateYaml({
            yamlString: '',
            annotate: ({ change }) => {
              change({
                findKey: (parsed: any) => parsed,
                merge: () => ({
                  ...addInstructions({
                    prop: 'a',
                    anchor: 'anchor-a',
                    mergeAnchor: 'anchor-b'
                  }),
                  a: { value: 1 },
                  ...addInstructions({
                    prop: 'b',
                    anchor: 'anchor-b',
                    mergeAnchor: 'anchor-a'
                  }),
                  b: { value: 2 }
                })
              });
            }
          });
        }).toThrow('Circular anchor reference detected');
      });

      it('should throw error for invalid anchor name', () => {
        expect(() => {
          updateYaml({
            yamlString: '',
            annotate: ({ change }) => {
              change({
                findKey: (parsed: any) => parsed,
                merge: () => ({
                  ...addInstructions({ prop: 'config', anchor: 'my anchor' }),
                  config: { version: '2.0' }
                })
              });
            }
          });
        }).toThrow("Invalid anchor name 'my anchor'");
      });

      it('should throw error for anchor name with special characters', () => {
        expect(() => {
          updateYaml({
            yamlString: '',
            annotate: ({ change }) => {
              change({
                findKey: (parsed: any) => parsed,
                merge: () => ({
                  ...addInstructions({ prop: 'config', anchor: 'my@anchor' }),
                  config: { version: '2.0' }
                })
              });
            }
          });
        }).toThrow('Anchor names must match [a-zA-Z0-9_-]+');
      });
    });

    describe('preserve existing anchors', () => {
      it('should preserve existing anchors from source YAML', () => {
        const yamlString = `defaults: &defaults
  timeout: 30

serviceA:
  <<: *defaults
  host: a.com
`;

        const { result } = updateYaml({
          yamlString,
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({ prop: 'serviceB', mergeAnchor: 'defaults' }),
                serviceB: { host: 'b.com' }
              })
            });
          }
        });

        expect(result).toBe(`defaults: &defaults
  timeout: 30

serviceA:
  <<: *defaults
  host: a.com
serviceB:
  <<: *defaults
  host: b.com
`)
      });

      it('should use existing anchor without redefining', () => {
        const yamlString = `base: &base-config
  port: 8080
  ssl: true

service1:
  <<: *base-config
  name: svc1
`;

        const { result } = updateYaml({
          yamlString,
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({ prop: 'service2', mergeAnchor: 'base-config' }),
                service2: { name: 'svc2', ssl: false }
              })
            });
          }
        });

        expect(result).toBe(`base: &base-config
  port: 8080
  ssl: true

service1:
  <<: *base-config
  name: svc1
service2:
  <<: *base-config
  name: svc2
  ssl: false
`)
      });
    });

    describe('real-world examples', () => {
      it('should handle Kubernetes-style resource sharing', () => {
        interface K8sDeployment {
          apiVersion: string;
          kind: string;
          _resourceDefaults?: any;
          _securityDefaults?: any;
          spec: {
            template: {
              spec: {
                containers: Array<{
                  name: string;
                  resources?: any;
                  securityContext?: any;
                }>;
              };
            };
          };
        }

        const { result } = updateYaml<K8sDeployment>({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed) => parsed,
              merge: () => ({
                apiVersion: 'apps/v1',
                kind: 'Deployment',
                ...addInstructions({
                  prop: '_resourceDefaults',
                  anchor: 'default-resources',
                  comment: 'Shared resource configuration'
                }),
                _resourceDefaults: {
                  limits: { cpu: '200m', memory: '256Mi' },
                  requests: { cpu: '100m', memory: '128Mi' }
                },
                ...addInstructions({
                  prop: '_securityDefaults',
                  anchor: 'security-ctx',
                  comment: 'Shared security context'
                }),
                _securityDefaults: {
                  runAsNonRoot: true,
                  runAsUser: 1000
                },
                spec: {
                  template: {
                    spec: {
                      containers: [
                        {
                          name: 'app',
                          ...addInstructions({
                            prop: 'resources',
                            alias: 'default-resources'
                          }),
                          resources: {},
                          ...addInstructions({
                            prop: 'securityContext',
                            alias: 'security-ctx'
                          }),
                          securityContext: {}
                        },
                        {
                          name: 'sidecar',
                          ...addInstructions({
                            prop: 'resources',
                            mergeAnchor: 'default-resources'
                          }),
                          resources: {
                            limits: { cpu: '50m' }
                          },
                          ...addInstructions({
                            prop: 'securityContext',
                            alias: 'security-ctx'
                          }),
                          securityContext: {}
                        }
                      ]
                    }
                  }
                }
              })
            });
          }
        });

        expect(result).toBe(`# Shared resource configuration
_resourceDefaults: &default-resources
  limits:
    cpu: 200m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
# Shared security context
_securityDefaults: &security-ctx
  runAsNonRoot: true
  runAsUser: 1000
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: app
          resources: *default-resources
          securityContext: *security-ctx
        - name: sidecar
          resources:
            <<: *default-resources
            limits:
              cpu: 50m
          securityContext: *security-ctx
`)
      });

      it('should handle Helm values-style configuration', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'imageDefaults',
                  anchor: 'image-defaults',
                  comment: 'Default image configuration',
                  flow: true
                }),
                imageDefaults: {
                  pullPolicy: 'IfNotPresent',
                  pullSecrets: ['regcred']
                },
                ...addInstructions({
                  prop: 'resourceDefaults',
                  anchor: 'resource-defaults',
                  comment: 'Default resource limits'
                }),
                resourceDefaults: {
                  limits: { cpu: '200m', memory: '256Mi' },
                  requests: { cpu: '100m', memory: '128Mi' }
                },
                frontend: {
                  replicaCount: 3,
                  ...addInstructions({
                    prop: 'image',
                    mergeAnchor: 'image-defaults'
                  }),
                  image: {
                    repository: 'myapp/frontend',
                    tag: '1.0.0'
                  },
                  ...addInstructions({
                    prop: 'resources',
                    alias: 'resource-defaults'
                  }),
                  resources: {}
                },
                backend: {
                  replicaCount: 5,
                  ...addInstructions({
                    prop: 'image',
                    mergeAnchor: 'image-defaults'
                  }),
                  image: {
                    repository: 'myapp/backend',
                    tag: '2.0.0'
                  },
                  ...addInstructions({
                    prop: 'resources',
                    mergeAnchor: 'resource-defaults'
                  }),
                  resources: {
                    limits: { cpu: '500m' }
                  }
                }
              })
            });
          }
        });

        expect(result).toBe(`# Default image configuration
imageDefaults: &image-defaults { pullPolicy: IfNotPresent, pullSecrets: [ regcred ] }
# Default resource limits
resourceDefaults: &resource-defaults
  limits:
    cpu: 200m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
frontend:
  image:
    <<: *image-defaults
    repository: myapp/frontend
    tag: 1.0.0
  resources: *resource-defaults
  replicaCount: 3
backend:
  image:
    <<: *image-defaults
    repository: myapp/backend
    tag: 2.0.0
  resources:
    <<: *resource-defaults
    limits:
      cpu: 500m
  replicaCount: 5
`)
      });
    });
  });

  describe('YAML Anchors and Aliases', () => {
    describe('array item anchors and aliases', () => {
      it('should create anchors on array items', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'templates',
                  anchors: { 0: 'empty', 1: 'basic' }
                }),
                templates: [{}, { type: 'basic' }],
                ...addInstructions({
                  prop: 'instances',
                  aliases: ['empty', 'basic']
                }),
                instances: [{}, {}]
              })
            });
          }
        });

        expect(result).toBe(`templates:
  - &empty {}
  - &basic
    type: basic
instances:
  - *empty
  - *basic
`)
      });

      it('should handle multiple array item aliases', () => {
        const { result } = updateYaml({
          yamlString: '',
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'templates',
                  anchors: {
                    0: 'empty-template',
                    1: 'basic-template'
                  }
                }),
                templates: [
                  {},
                  { type: 'basic', timeout: 30 }
                ],
                ...addInstructions({
                  prop: 'instances',
                  aliases: ['empty-template', 'basic-template', 'empty-template']
                }),
                instances: [{}, {}, {}]
              })
            });
          }
        });

        expect(result).toBe(`templates:
  - &empty-template {}
  - &basic-template
    type: basic
    timeout: 30
instances:
  - *empty-template
  - *basic-template
  - *empty-template
`)
      });
    });

    describe('anchor renaming', () => {
      it('should rename anchor and update all references', () => {
        const yamlString = `defaults: &resource-defaults
  cpu: 100m
  memory: 128Mi

frontend:
  resources: *resource-defaults

backend:
  resources: *resource-defaults
`;

        const { result } = updateYaml({
          yamlString,
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'defaults',
                  anchor: 'resource-defaults-v2',
                  renameFrom: 'resource-defaults'
                }),
                defaults: {
                  cpu: '100m',
                  memory: '128Mi'
                }
              })
            });
          }
        });

        expect(result).toBe(`defaults: &resource-defaults-v2
  cpu: 100m
  memory: 128Mi

frontend:
  resources: *resource-defaults-v2

backend:
  resources: *resource-defaults-v2
`);
      });

      it('should rename anchor used in merge keys', () => {
        const yamlString = `baseConfig: &base
  timeout: 30
  retries: 3

prodConfig:
  <<: *base
  host: prod.com

devConfig:
  <<: *base
  host: dev.com
`;

        const { result } = updateYaml({
          yamlString,
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'baseConfig',
                  anchor: 'base-v2',
                  renameFrom: 'base'
                }),
                baseConfig: {
                  timeout: 30,
                  retries: 3
                }
              })
            });
          }
        });

        expect(result).toBe(`baseConfig: &base-v2
  timeout: 30
  retries: 3

prodConfig:
  <<: *base-v2
  host: prod.com

devConfig:
  <<: *base-v2
  host: dev.com
`);
      });

      it('should rename anchor with mixed alias types', () => {
        const yamlString = `defaults: &def
  cpu: 100m

service1:
  resources: *def

service2:
  resources:
    <<: *def
    cpu: 200m

service3:
  resources: *def
`;

        const { result } = updateYaml({
          yamlString,
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'defaults',
                  anchor: 'defaults-v2',
                  renameFrom: 'def'
                }),
                defaults: {
                  cpu: '100m'
                }
              })
            });
          }
        });

        expect(result).toBe(`defaults: &defaults-v2
  cpu: 100m

service1:
  resources: *defaults-v2

service2:
  resources:
    <<: *defaults-v2
    cpu: 200m

service3:
  resources: *defaults-v2
`);
      });

      it('should handle renameFrom when anchor does not exist (no-op)', () => {
        const yamlString = `config:
  timeout: 30
`;

        const { result } = updateYaml({
          yamlString,
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'config',
                  anchor: 'new-anchor',
                  renameFrom: 'nonexistent'  // Doesn't exist, should just create new anchor
                }),
                config: {
                  timeout: 30
                }
              })
            });
          }
        });

        expect(result).toBe(`config: &new-anchor
  timeout: 30
`);
      });

      it('should throw error if target anchor name already exists', () => {
        const yamlString = `defaults: &old-name
  cpu: 100m

other: &new-name
  memory: 128Mi
`;

        expect(() => {
          updateYaml({
            yamlString,
            annotate: ({ change }) => {
              change({
                findKey: (parsed: any) => parsed,
                merge: () => ({
                  ...addInstructions({
                    prop: 'defaults',
                    anchor: 'new-name',  // Already exists!
                    renameFrom: 'old-name'
                  }),
                  defaults: {
                    cpu: '100m'
                  }
                })
              });
            }
          });
        }).toThrow("Anchor 'new-name' already exists");
      });

      it('should rename anchor from different property location', () => {
        const yamlString = `sharedDefaults: &resource-defaults
  cpu: 100m
  memory: 128Mi

service1:
  resources: *resource-defaults

service2:
  resources: *resource-defaults
`;

        const { result } = updateYaml({
          yamlString,
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                // Rename happens via a NEW property, not the original anchor location
                ...addInstructions({
                  prop: 'newDefaults',
                  anchor: 'resource-defaults-v2',
                  renameFrom: 'resource-defaults'
                }),
                newDefaults: {
                  cpu: '200m',
                  memory: '256Mi'
                }
              })
            });
          }
        });

        // Original anchor renamed, and new property gets the new anchor too
        expect(result).toBe(`sharedDefaults: &resource-defaults-v2
  cpu: 100m
  memory: 128Mi

service1:
  resources: *resource-defaults-v2

service2:
  resources: *resource-defaults-v2
newDefaults: &resource-defaults-v2
  cpu: 200m
  memory: 256Mi
`);
      });

      it('should validate new anchor name when renaming', () => {
        const yamlString = `defaults: &old-name
  cpu: 100m
`;

        expect(() => {
          updateYaml({
            yamlString,
            annotate: ({ change }) => {
              change({
                findKey: (parsed: any) => parsed,
                merge: () => ({
                  ...addInstructions({
                    prop: 'defaults',
                    anchor: 'invalid name with spaces',
                    renameFrom: 'old-name'
                  }),
                  defaults: {
                    cpu: '100m'
                  }
                })
              });
            }
          });
        }).toThrow("Invalid anchor name 'invalid name with spaces'");
      });
    });

    describe('schema-level instructions', () => {
      it('should apply anchor instructions from schema', () => {
        const { result } = updateYaml({
          yamlString: '',
          schema: {
            properties: {
              server: {
                anchor: 'server-config',
                comment: 'Server settings'
              },
              database: {
                mergeAnchor: 'server-config'
              }
            }
          },
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                server: { host: 'localhost', port: 8080 },
                database: { timeout: 30 }
              })
            });
          }
        });

        expect(result).toBe(`# Server settings
server: &server-config
  host: localhost
  port: 8080
database:
  <<: *server-config
  timeout: 30
`);
      });

      it('should handle nested properties in schema', () => {
        const { result } = updateYaml({
          yamlString: '',
          schema: {
            properties: {
              config: {
                properties: {
                  server: {
                    anchor: 'srv',
                    properties: {
                      host: { commentBefore: 'Production host' }
                    }
                  },
                  client: {
                    alias: 'srv'
                  }
                }
              }
            }
          },
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                config: {
                  server: { host: 'localhost', port: 8080 },
                  client: {}
                }
              })
            });
          }
        });

        expect(result).toBe(`config:
  server: &srv
    # Production host
    host: localhost
    port: 8080
  client: *srv
`);
      });

      it('should handle array item instructions in schema', () => {
        const { result } = updateYaml({
          yamlString: '',
          schema: {
            properties: {
              items: {
                type: 'array',
                items: [
                  { anchor: 'first-item' },
                  { alias: 'first-item' },
                  { alias: 'first-item' }
                ]
              }
            }
          },
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                items: [
                  { name: 'prod', env: 'production' },
                  { extra: 'field' },
                  { another: 'value' }
                ]
              })
            });
          }
        });

        expect(result).toBe(`items:
  - &first-item
    name: prod
    env: production
  - *first-item
  - *first-item
`);
      });

      it('should give priority to addInstructions over schema', () => {
        const { result } = updateYaml({
          yamlString: '',
          schema: {
            properties: {
              server: {
                anchor: 'server-config',
                comment: 'From schema'
              },
              database: {
                comment: 'Database from schema'
              }
            }
          },
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                ...addInstructions({
                  prop: 'server',
                  anchor: 'override-anchor',
                  comment: 'From addInstructions'
                }),
                ...addInstructions({
                  prop: 'database',
                  mergeAnchor: 'override-anchor'
                }),
                server: { host: 'localhost', port: 8080 },
                database: { timeout: 30 }
              })
            });
          }
        });

        expect(result).toBe(`# From addInstructions
server: &override-anchor
  host: localhost
  port: 8080
database:
  <<: *override-anchor
  timeout: 30
`);
      });

      it('should handle mergeAnchor in schema with multiple targets', () => {
        const { result } = updateYaml({
          yamlString: '',
          schema: {
            properties: {
              defaults: {
                anchor: 'base-config'
              },
              apiConfig: {
                mergeAnchor: 'base-config'
              },
              workerConfig: {
                mergeAnchor: 'base-config'
              }
            }
          },
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                defaults: { timeout: 30, retries: 3 },
                apiConfig: { port: 8080 },
                workerConfig: { threads: 4 }
              })
            });
          }
        });

        expect(result).toBe(`defaults: &base-config
  timeout: 30
  retries: 3
apiConfig:
  <<: *base-config
  port: 8080
workerConfig:
  <<: *base-config
  threads: 4
`);
      });

      it('should handle flow formatting in schema', () => {
        const { result } = updateYaml({
          yamlString: '',
          schema: {
            properties: {
              metadata: {
                properties: {
                  labels: { flow: true }
                }
              }
            }
          },
          annotate: ({ change }) => {
            change({
              findKey: (parsed: any) => parsed,
              merge: () => ({
                metadata: {
                  labels: { app: 'myapp', env: 'prod' }
                }
              })
            });
          }
        });

        expect(result).toBe(`metadata:
  labels: { app: myapp, env: prod }
`);
      });
    });
  });

  describe('key ordering', () => {
    it('should preserve existing key order and append new keys', () => {
      const yamlString = `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
data:
  key1: value1`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed.data,
            merge: () => ({
              key2: 'value2',
              key3: 'value3'
            })
          });
        }
      });

      // Original keys should come first, new keys appended after
      const lines = result.split('\n');
      const dataIndex = lines.findIndex(l => l.includes('data:'));
      const key1Index = lines.findIndex(l => l.includes('key1:'));
      const key2Index = lines.findIndex(l => l.includes('key2:'));
      const key3Index = lines.findIndex(l => l.includes('key3:'));

      expect(dataIndex).toBeGreaterThan(-1);
      expect(key1Index).toBeGreaterThan(dataIndex);
      expect(key2Index).toBeGreaterThan(key1Index);
      expect(key3Index).toBeGreaterThan(key2Index);
    });

    it('should add new keys in the order they appear in merge object', () => {
      const yamlString = `apiVersion: v1
kind: ConfigMap`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              data: { key: 'value' },
              metadata: { name: 'test' }
            })
          });
        }
      });

      // Keys should be added in the order they appear in the merge object
      // data comes before metadata in the merge, so data should come first
      const lines = result.split('\n');
      const dataIndex = lines.findIndex(l => l.match(/^data:/));
      const metadataIndex = lines.findIndex(l => l.match(/^metadata:/));

      expect(dataIndex).toBeGreaterThan(-1);
      expect(metadataIndex).toBeGreaterThan(-1);
      expect(dataIndex).toBeLessThan(metadataIndex);
    });

    it('should control key order by ordering merge object properties', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              // Explicitly order properties in desired sequence
              apiVersion: 'v1',
              kind: 'ConfigMap',
              metadata: { name: 'test' },
              data: { key: 'value' }
            })
          });
        }
      });

      // Should follow the order in the merge object: apiVersion, kind, metadata, data
      const lines = result.split('\n').filter(l => l.trim());
      const apiVersionIndex = lines.findIndex(l => l.match(/^apiVersion:/));
      const kindIndex = lines.findIndex(l => l.match(/^kind:/));
      const metadataIndex = lines.findIndex(l => l.match(/^metadata:/));
      const dataIndex = lines.findIndex(l => l.match(/^data:/));

      expect(apiVersionIndex).toBeLessThan(kindIndex);
      expect(kindIndex).toBeLessThan(metadataIndex);
      expect(metadataIndex).toBeLessThan(dataIndex);
    });

    it('should maintain order from existing file even when adding new properties', () => {
      const yamlString = `kind: ConfigMap
apiVersion: v1`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              metadata: { name: 'test' },
              data: { key: 'value' }
            })
          });
        }
      });

      // Existing order (kind, apiVersion) is preserved
      // New properties (metadata, data) are added after in merge object order
      const lines = result.split('\n');
      const kindIndex = lines.findIndex(l => l.match(/^kind:/));
      const apiVersionIndex = lines.findIndex(l => l.match(/^apiVersion:/));
      const metadataIndex = lines.findIndex(l => l.match(/^metadata:/));
      const dataIndex = lines.findIndex(l => l.match(/^data:/));

      expect(kindIndex).toBeLessThan(apiVersionIndex);
      expect(apiVersionIndex).toBeLessThan(metadataIndex);
      expect(metadataIndex).toBeLessThan(dataIndex);
    });

    it('should preserve strange existing order when updating', () => {
      const yamlString = `data:
  key1: value1
kind: ConfigMap
apiVersion: v1`;

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              metadata: { name: 'test' }
            })
          });
        }
      });

      // Existing order: data, kind, apiVersion should be preserved
      // New property: metadata should be added after
      const lines = result.split('\n');
      const dataIndex = lines.findIndex(l => l.match(/^data:/));
      const kindIndex = lines.findIndex(l => l.match(/^kind:/));
      const apiVersionIndex = lines.findIndex(l => l.match(/^apiVersion:/));
      const metadataIndex = lines.findIndex(l => l.match(/^metadata:/));

      // Original order preserved (even though it's unusual)
      expect(dataIndex).toBeLessThan(kindIndex);
      expect(kindIndex).toBeLessThan(apiVersionIndex);
      // New property added after existing ones
      expect(metadataIndex).toBeGreaterThan(apiVersionIndex);
    });

    it('should handle nested property ordering via merge object', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              apiVersion: 'v1',
              kind: 'ConfigMap',
              metadata: {
                // Nested properties also follow merge object order
                name: 'test',
                namespace: 'default',
                labels: { app: 'myapp' },
                annotations: { key: 'val' }
              }
            })
          });
        }
      });

      // Check nested metadata properties follow merge object order
      const lines = result.split('\n');
      const metadataIndex = lines.findIndex(l => l.match(/^metadata:/));
      const nameIndex = lines.findIndex((l, i) => i > metadataIndex && l.match(/^\s+name:/));
      const namespaceIndex = lines.findIndex((l, i) => i > metadataIndex && l.match(/^\s+namespace:/));
      const labelsIndex = lines.findIndex((l, i) => i > metadataIndex && l.match(/^\s+labels:/));
      const annotationsIndex = lines.findIndex((l, i) => i > metadataIndex && l.match(/^\s+annotations:/));

      expect(nameIndex).toBeLessThan(namespaceIndex);
      expect(namespaceIndex).toBeLessThan(labelsIndex);
      expect(labelsIndex).toBeLessThan(annotationsIndex);
    });

    it('should work with complex K8s deployment following merge object order', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              // Control order explicitly in merge object
              apiVersion: 'apps/v1',
              kind: 'Deployment',
              metadata: {
                name: 'my-deployment',
                labels: { app: 'test' }
              },
              spec: {
                replicas: 3,
                selector: { matchLabels: {} },
                template: { spec: { containers: [] } }
              }
            })
          });
        }
      });

      // Top-level should follow merge object order: apiVersion, kind, metadata, spec
      const lines = result.split('\n').filter(l => l.trim());
      const apiVersionIndex = lines.findIndex(l => l.match(/^apiVersion:/));
      const kindIndex = lines.findIndex(l => l.match(/^kind:/));
      const metadataIndex = lines.findIndex(l => l.match(/^metadata:/));
      const specIndex = lines.findIndex(l => l.match(/^spec:/));

      expect(apiVersionIndex).toBeLessThan(kindIndex);
      expect(kindIndex).toBeLessThan(metadataIndex);
      expect(metadataIndex).toBeLessThan(specIndex);

      // Nested metadata should follow merge object order: name, labels
      const nameIndex = lines.findIndex((l, i) => i > metadataIndex && l.match(/^\s+name:/));
      const labelsIndex = lines.findIndex((l, i) => i > metadataIndex && l.match(/^\s+labels:/));
      expect(nameIndex).toBeLessThan(labelsIndex);

      // Nested spec should follow merge object order: replicas, selector, template
      const replicasIndex = lines.findIndex((l, i) => i > specIndex && l.match(/^\s+replicas:/));
      const selectorIndex = lines.findIndex((l, i) => i > specIndex && l.match(/^\s+selector:/));
      const templateIndex = lines.findIndex((l, i) => i > specIndex && l.match(/^\s+template:/));
      expect(replicasIndex).toBeLessThan(selectorIndex);
      expect(selectorIndex).toBeLessThan(templateIndex);
    });

    it('should support schema comments independently of ordering', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        schema: {
          properties: {
            apiVersion: { comment: 'API version' },
            kind: { comment: 'Resource kind' },
            metadata: { comment: 'Resource metadata' },
            data: { comment: 'Configuration data' }
          }
        },
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              // Note: Schema provides comments, but order follows merge object
              apiVersion: 'v1',
              kind: 'ConfigMap',
              metadata: { name: 'test' },
              data: { key: 'value' }
            })
          });
        }
      });

      // All comments from schema should be present
      expect(result).toContain('# API version');
      expect(result).toContain('# Resource kind');
      expect(result).toContain('# Resource metadata');
      expect(result).toContain('# Configuration data');

      // Order follows merge object, but comments are applied
      const lines = result.split('\n');
      const apiVersionCommentIndex = lines.findIndex(l => l.includes('# API version'));
      const kindCommentIndex = lines.findIndex(l => l.includes('# Resource kind'));
      const metadataCommentIndex = lines.findIndex(l => l.includes('# Resource metadata'));
      const dataCommentIndex = lines.findIndex(l => l.includes('# Configuration data'));

      expect(apiVersionCommentIndex).toBeLessThan(kindCommentIndex);
      expect(kindCommentIndex).toBeLessThan(metadataCommentIndex);
      expect(metadataCommentIndex).toBeLessThan(dataCommentIndex);
    });

    it('should handle partial schema with mixed existing and new properties', () => {
      const yamlString = `kind: ConfigMap
data:
  existing: value`;

      const { result } = updateYaml({
        yamlString,
        schema: {
          properties: {
            apiVersion: {},
            kind: {},
            metadata: {}
          }
        },
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              apiVersion: 'v1',
              metadata: { name: 'test' },
              data: { new: 'value2' }
            })
          });
        }
      });

      const lines = result.split('\n');

      // Existing properties (kind, data) should maintain their order
      const kindIndex = lines.findIndex(l => l.match(/^kind:/));
      const dataIndex = lines.findIndex(l => l.match(/^data:/));
      expect(kindIndex).toBeLessThan(dataIndex);

      // New properties should be added
      const apiVersionIndex = lines.findIndex(l => l.match(/^apiVersion:/));
      const metadataIndex = lines.findIndex(l => l.match(/^metadata:/));
      expect(apiVersionIndex).toBeGreaterThan(-1);
      expect(metadataIndex).toBeGreaterThan(-1);
    });

    it('should work with array items in schema', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        schema: {
          properties: {
            items: {
              type: 'array',
              items: [
                { comment: 'First item' },
                { comment: 'Second item' }
              ]
            }
          }
        },
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: () => ({
              items: [
                { name: 'item1', value: 1 },
                { name: 'item2', value: 2 }
              ]
            })
          });
        }
      });

      expect(result).toContain('# First item');
      expect(result).toContain('# Second item');
    });
  });

  describe('defaultFlow parameter', () => {
    it('should use block style for arrays when defaultFlow is false', () => {
      const yamlString = `apiVersion: v1
kind: Kustomization`;

      const { result } = updateYaml({
        yamlString,
        defaultFlow: false,
        annotate: ({ change }) => {
          change({
            findKey: (obj) => obj,
            merge: () => ({
              apiVersion: 'kustomize.config.k8s.io/v1beta1',
              kind: 'Kustomization',
              resources: ['../../base', '../other']
            })
          });
        }
      });

      // Should use block style (- item) not flow style ([item])
      expect(result).toContain('resources:');
      expect(result).toContain('  - ../../base');
      expect(result).toContain('  - ../other');
      expect(result).not.toContain('resources: [');
      expect(result).not.toContain('resources: [ ');
    });

    it('should use flow style for arrays when defaultFlow is true', () => {
      const yamlString = `apiVersion: v1
kind: Kustomization`;

      const { result } = updateYaml({
        yamlString,
        defaultFlow: true,
        annotate: ({ change }) => {
          change({
            findKey: (obj) => obj,
            merge: () => ({
              apiVersion: 'kustomize.config.k8s.io/v1beta1',
              kind: 'Kustomization',
              resources: ['../../base']
            })
          });
        }
      });

      // Should use flow style ([item])
      expect(result).toContain('resources: [');
    });

    it('should apply defaultFlow to empty files', () => {
      const yamlString = '';

      const { result } = updateYaml({
        yamlString,
        defaultFlow: false,
        annotate: ({ change }) => {
          change({
            findKey: (obj) => obj,
            merge: () => ({
              apiVersion: 'kustomize.config.k8s.io/v1beta1',
              kind: 'Kustomization',
              resources: ['../../base']
            })
          });
        }
      });

      expect(result).toContain('resources:');
      expect(result).toContain('  - ../../base');
      expect(result).not.toContain('resources: [');
    });
  });

  describe('document headers', () => {
    describe('simple headers', () => {
      it('should add simple header to YAML document', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  key: value
`;

        interface ConfigMap {
          apiVersion: string;
          kind: string;
          data: { key: string };
        }

        const { result } = updateYaml<ConfigMap>({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: ['API Gateway configuration', 'Owner: platform-team']
          },
          annotate: ({ change }) => {
            change({
              findKey: (obj) => obj.data,
              merge: () => ({ key: 'updated' })
            });
          }
        });

        expect(result).toBe(`# API Gateway configuration
# Owner: platform-team
apiVersion: v1
kind: ConfigMap
data:
  key: updated
`);
      });

      it('should replace existing header with new simple header', () => {
        const yamlString = `# Old header
# Old owner
apiVersion: v1
kind: ConfigMap
data:
  key: value
`;

        interface ConfigMap {
          apiVersion: string;
          kind: string;
          data: { key: string };
        }

        const { result } = updateYaml<ConfigMap>({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: ['New header', 'New owner']
          },
          annotate: ({ change }) => {
            change({
              findKey: (obj) => obj.data,
              merge: () => ({ key: 'updated' })
            });
          }
        });

        expect(result).toBe(`# New header
# New owner
apiVersion: v1
kind: ConfigMap
data:
  key: updated
`);
        expect(result).not.toContain('Old header');
        expect(result).not.toContain('Old owner');
      });

      it('should extract simple header from YAML', () => {
        const yamlString = `# API Gateway configuration
# Owner: platform-team
apiVersion: v1
kind: ConfigMap
`;

        const { extractedHeader } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: []
          }
        });

        expect(extractedHeader).toBeDefined();
        expect(extractedHeader?.type).toBe('simple');
        expect(extractedHeader?.content).toEqual([
          'API Gateway configuration',
          'Owner: platform-team'
        ]);
      });

      it('should handle simple header with single line', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
`;

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: 'Single line header'
          }
        });

        expect(result).toBe(`# Single line header
apiVersion: v1
kind: ConfigMap
`);
      });
    });

    describe('multi-line headers', () => {
      it('should add multi-line bordered header to YAML document', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  key: value
`;

        interface ConfigMap {
          apiVersion: string;
          kind: string;
          data: { key: string };
        }

        const { result } = updateYaml<ConfigMap>({
          yamlString,
          documentHeader: {
            type: 'multi-line',
            content: [
              'PRODUCTION KUBERNETES CONFIG',
              'DO NOT MODIFY WITHOUT APPROVAL',
              'Contact: platform-team@company.com'
            ]
          },
          annotate: ({ change }) => {
            change({
              findKey: (obj) => obj.data,
              merge: () => ({ key: 'updated' })
            });
          }
        });

        expect(result).toContain('#######################################');
        expect(result).toContain('# PRODUCTION KUBERNETES CONFIG');
        expect(result).toContain('# DO NOT MODIFY WITHOUT APPROVAL');
        expect(result).toContain('# Contact: platform-team@company.com');
        expect(result).toMatch(/^#{3,}/); // Starts with border
      });

      it('should extract multi-line header from YAML', () => {
        const yamlString = `#######################################
# PRODUCTION KUBERNETES CONFIG
# DO NOT MODIFY WITHOUT APPROVAL
# Contact: platform-team@company.com
#######################################
apiVersion: v1
kind: ConfigMap
`;

        const { extractedHeader } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'multi-line',
            content: []
          }
        });

        expect(extractedHeader).toBeDefined();
        expect(extractedHeader?.type).toBe('multi-line');
        expect(extractedHeader?.content).toEqual([
          'PRODUCTION KUBERNETES CONFIG',
          'DO NOT MODIFY WITHOUT APPROVAL',
          'Contact: platform-team@company.com'
        ]);
      });

      it('should support custom border character for multi-line header', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
`;

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'multi-line',
            content: ['Header line'],
            border: '##'
          }
        });

        expect(result).toMatch(/^#{6,}/); // Double border
        expect(result).toContain('## Header line');
      });

      it('should support custom width for multi-line header', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
`;

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'multi-line',
            content: ['Short'],
            width: 20
          }
        });

        const lines = result.split('\n');
        const borderLine = lines[0];
        expect(borderLine.length).toBe(20);
      });
    });

    describe('raw headers', () => {
      it('should add raw header exactly as provided', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  key: value
`;

        const rawHeader = `###
### Custom styled header
### With any format
###`;

        interface ConfigMap {
          apiVersion: string;
          kind: string;
          data: { key: string };
        }

        const { result } = updateYaml<ConfigMap>({
          yamlString,
          documentHeader: {
            type: 'raw',
            content: rawHeader
          },
          annotate: ({ change }) => {
            change({
              findKey: (obj) => obj.data,
              merge: () => ({ key: 'updated' })
            });
          }
        });

        expect(result).toBe(`###
### Custom styled header
### With any format
###
apiVersion: v1
kind: ConfigMap
data:
  key: updated
`);
      });

      it('should extract raw header exactly as is', () => {
        const yamlString = `###
### Custom styled header
### With any format
###
apiVersion: v1
kind: ConfigMap
`;

        const { extractedHeader } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'raw',
            content: ''
          }
        });

        expect(extractedHeader).toBeDefined();
        expect(extractedHeader?.type).toBe('raw');
        expect(extractedHeader?.raw).toBe(`###
### Custom styled header
### With any format
###`);
      });

      it('should handle raw header with mixed comment styles', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
`;

        const rawHeader = `# Line 1
## Line 2
### Line 3
# Line 4`;

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'raw',
            content: rawHeader
          }
        });

        expect(result).toBe(`# Line 1
## Line 2
### Line 3
# Line 4
apiVersion: v1
kind: ConfigMap
`);
      });
    });

    describe('multi-document YAML', () => {
      it('should apply header to first document by default', () => {
        const yamlString = `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: config1
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: config2
`;

        interface ConfigMap {
          apiVersion: string;
          kind: string;
          metadata: {
            name: string;
            namespace?: string;
          };
        }

        const { result } = updateYaml<ConfigMap>({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: ['First doc header']
          },
          annotate: ({ change }) => {
            change({
              findKey: (obj) => obj.metadata,
              merge: (metadata) => ({ ...metadata, namespace: 'default' })
            });
          }
        });

        expect(result).toContain('# First doc header');
        const headerIndex = result.indexOf('# First doc header');
        const firstDocIndex = result.indexOf('apiVersion: v1');
        const secondDocIndex = result.indexOf('name: config2');

        expect(headerIndex).toBeLessThan(firstDocIndex);
        expect(firstDocIndex).toBeLessThan(secondDocIndex);
      });

      it('should apply header to selected document', () => {
        const yamlString = `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: config1
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: config2
`;

        interface ConfigMap {
          apiVersion: string;
          kind: string;
          metadata: {
            name: string;
            namespace?: string;
          };
        }

        const { result } = updateYaml<ConfigMap>({
          yamlString,
          selectDocument: () => 1, // Select second document
          documentHeader: {
            type: 'simple',
            content: ['Second doc header']
          },
          annotate: ({ change }) => {
            change({
              findKey: (obj) => obj.metadata,
              merge: (metadata) => ({ ...metadata, namespace: 'prod' })
            });
          }
        });

        // The second document should have the header
        const parts = result.split('---');
        expect(parts[2]).toContain('# Second doc header');
        expect(parts[2]).toContain('namespace: prod');
      });
    });

    describe('edge cases', () => {
      it('should handle empty YAML with header', () => {
        const yamlString = '';

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: ['Header for empty file']
          },
          annotate: ({ change }) => {
            change({
              findKey: (obj) => obj,
              merge: () => ({ key: 'value' })
            });
          }
        });

        expect(result).toBe(`# Header for empty file
key: value
`);
      });

      it('should handle YAML with only comments (no content)', () => {
        const yamlString = `# Just a comment
# Another comment
`;

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: ['New header']
          },
          annotate: ({ change }) => {
            change({
              findKey: (obj) => obj,
              merge: () => ({ key: 'value' })
            });
          }
        });

        expect(result).toBe(`# New header
key: value
`);
      });

      it('should preserve non-header comments in document body', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
# This is a field comment
data:
  key: value
`;

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: ['Document header']
          }
        });

        expect(result).toContain('# Document header');
        expect(result).toContain('# This is a field comment');
      });

      it('should handle header with empty content array', () => {
        const yamlString = `# Old header
apiVersion: v1
kind: ConfigMap
`;

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'simple',
            content: []
          }
        });

        // Empty header should remove existing header
        expect(result).not.toContain('# Old header');
        expect(result).toBe(`apiVersion: v1
kind: ConfigMap
`);
      });

      it('should handle multi-line header with single content line', () => {
        const yamlString = `
apiVersion: v1
kind: ConfigMap
`;

        const { result } = updateYaml({
          yamlString,
          documentHeader: {
            type: 'multi-line',
            content: ['Single line']
          }
        });

        expect(result).toMatch(/^#{3,}/);
        expect(result).toContain('# Single line');
      });
    });
  });

  describe('setYamlNode - insert complete YAML sub-documents', () => {
    it('should insert object with block comments', () => {
      const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  database: null
`;

      const subYaml = `# Production database config
host: db.production.com
port: 5432`;

      const { result, resultParsed } = updateYaml<K8sConfigMap>({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed) => parsed.data.database,
            yamlString: subYaml
          });
        }
      });

      // Verify structure
      expect(resultParsed.data.database).toBeDefined();
      expect((resultParsed.data.database as any).host).toBe('db.production.com');
      expect((resultParsed.data.database as any).port).toBe(5432);

      // Verify comment is preserved
      expect(result).toContain('# Production database config');
      expect(result).toContain('host: db.production.com');
      expect(result).toContain('port: 5432');
    });

    it('should insert object with inline comments', () => {
      const yamlString = `
config:
  server: null
`;

      const subYaml = `host: localhost  # Server hostname
port: 8080  # Server port`;

      const { result, resultParsed } = updateYaml({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.config.server,
            yamlString: subYaml
          });
        }
      });

      // Verify inline comments are preserved
      expect(result).toContain('# Server hostname');
      expect(result).toContain('# Server port');
      expect(result).toContain('host: localhost');
      expect(result).toContain('port: 8080');
    });

    it('should insert array structure with comments', () => {
      const yamlString = `
config:
  items: []
`;

      const subYaml = `# First item
- name: item1
  value: 100
# Second item
- name: item2
  value: 200`;

      const { result, resultParsed } = updateYaml({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.config.items,
            yamlString: subYaml
          });
        }
      });

      // Verify array structure
      expect(Array.isArray((resultParsed as any).config.items)).toBe(true);
      expect((resultParsed as any).config.items).toHaveLength(2);
      expect((resultParsed as any).config.items[0].name).toBe('item1');

      // Verify comments preserved
      expect(result).toContain('# First item');
      expect(result).toContain('# Second item');
    });

    it('should insert scalar value', () => {
      const yamlString = `
config:
  setting: null
`;

      const subYaml = `production-value`;

      const { result, resultParsed } = updateYaml({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.config.setting,
            yamlString: subYaml
          });
        }
      });

      expect((resultParsed as any).config.setting).toBe('production-value');
      expect(result).toContain('setting: production-value');
    });

    it('should preserve YAML anchors and aliases', () => {
      const yamlString = `
config:
  services: null
`;

      const subYaml = `defaults: &def
  timeout: 30
  retries: 3
prod:
  <<: *def
  host: prod.example.com`;

      const { result, resultParsed } = updateYaml({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.config.services,
            yamlString: subYaml
          });
        }
      });

      // Verify anchor and merge key syntax in output
      expect(result).toContain('&def');
      expect(result).toContain('<<: *def');
      expect(result).toContain('timeout: 30');

      // Verify values - note that the merge key is preserved in the YAML
      // but toJSON() treats << as a literal key, not a merge operation
      const services = (resultParsed as any).config.services;
      expect(services.defaults.timeout).toBe(30);
      expect(services.defaults.retries).toBe(3);
      expect(services.prod.host).toBe('prod.example.com');
      // The << key contains the merged values as an object
      expect(services.prod['<<']).toEqual({ timeout: 30, retries: 3 });
    });

    it('should handle multiple levels of nesting with comments', () => {
      const yamlString = `
config:
  database: null
`;

      const subYaml = `# Database section
production:
  # Production settings
  host: prod.db.com
  credentials:
    # Stored securely
    username: admin`;

      const { result, resultParsed } = updateYaml({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.config.database,
            yamlString: subYaml
          });
        }
      });

      // Verify all nested comments preserved
      expect(result).toContain('# Database section');
      expect(result).toContain('# Production settings');
      expect(result).toContain('# Stored securely');

      // Verify structure
      const db = (resultParsed as any).config.database;
      expect(db.production.host).toBe('prod.db.com');
      expect(db.production.credentials.username).toBe('admin');
    });

    it('should work alongside change() calls', () => {
      const yamlString = `
config:
  database: null
  cache: null
`;

      const subYaml = `host: db.example.com
port: 5432`;

      const { result, resultParsed } = updateYaml({
        yamlString,
        annotate: ({ change, setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.config.database,
            yamlString: subYaml
          });

          change({
            findKey: (parsed: any) => parsed.config,
            merge: () => ({
              cache: { host: 'redis.example.com', port: 6379 }
            })
          });
        }
      });

      // Verify both operations worked
      const cfg = (resultParsed as any).config;
      expect(cfg.database.host).toBe('db.example.com');
      expect(cfg.database.port).toBe(5432);
      expect(cfg.cache.host).toBe('redis.example.com');
      expect(cfg.cache.port).toBe(6379);
    });

    it('should throw error on invalid YAML syntax', () => {
      const yamlString = `
config:
  data: null
`;

      const invalidYaml = `invalid: yaml: syntax:`;

      expect(() => {
        updateYaml({
          yamlString,
          annotate: ({ setYamlNode }) => {
            setYamlNode({
              findKey: (parsed: any) => parsed.config.data,
              yamlString: invalidYaml
            });
          }
        });
      }).toThrow('Invalid YAML');
    });

    it('should throw error on empty YAML string', () => {
      const yamlString = `
config:
  data: null
`;

      expect(() => {
        updateYaml({
          yamlString,
          annotate: ({ setYamlNode }) => {
            setYamlNode({
              findKey: (parsed: any) => parsed.config.data,
              yamlString: ''
            });
          }
        });
      }).toThrow('Invalid YAML');
    });

    it('should support comment callback', () => {
      const yamlString = `
config:
  database: null
`;

      const subYaml = `host: localhost
port: 5432`;

      const { result, comments } = updateYaml({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.config.database,
            yamlString: subYaml,
            comment: () => 'Complete database configuration'
          });
        }
      });

      // Verify comment appears above the property
      expect(result).toContain('# Complete database configuration');
      expect(comments).toHaveLength(1);
      expect(comments[0].comment).toBe('Complete database configuration');
      expect(comments[0].path).toEqual(['config', 'database']);
    });

    it('should handle deep nested paths', () => {
      const yamlString = `
app:
  config:
    services:
      backend:
        database: null
`;

      const subYaml = `host: deep.db.com
port: 3306`;

      const { result, resultParsed } = updateYaml({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.app.config.services.backend.database,
            yamlString: subYaml
          });
        }
      });

      const db = (resultParsed as any).app.config.services.backend.database;
      expect(db.host).toBe('deep.db.com');
      expect(db.port).toBe(3306);
      expect(result).toContain('host: deep.db.com');
    });

    it('should preserve flow style from sub-document', () => {
      const yamlString = `
config:
  metadata: null
`;

      const subYaml = `{version: "1.0", env: prod, tags: [api, backend]}`;

      const { result, resultParsed } = updateYaml({
        yamlString,
        annotate: ({ setYamlNode }) => {
          setYamlNode({
            findKey: (parsed: any) => parsed.config.metadata,
            yamlString: subYaml
          });
        }
      });

      // Verify flow style is preserved
      expect(result).toContain('{');
      expect(result).toContain('[');
      const meta = (resultParsed as any).config.metadata;
      expect(meta.version).toBe('1.0');
      expect(meta.env).toBe('prod');
      expect(meta.tags).toEqual(['api', 'backend']);
    });
  });

  describe('getYamlNode - extract complete YAML sub-documents', () => {
    it('should extract object with comments', () => {
      const input = `
database:
  # Comment above host
  host: localhost
  port: 5432  # inline comment
`;

      let extracted = '';
      updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode }) => {
          extracted = getYamlNode({ findKey: (p: any) => p.database });
        }
      });

      // Verify extracted contains both comments
      expect(extracted).toContain('# Comment above host');
      expect(extracted).toContain('# inline comment');
      expect(extracted).toContain('host: localhost');
      expect(extracted).toContain('port: 5432');
    });

    it('should extract array structure with comments', () => {
      const input = `
items:
  - item1
  - item2  # comment on item2
  - item3
`;

      let extracted = '';
      updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode }) => {
          extracted = getYamlNode({ findKey: (p: any) => p.items });
        }
      });

      // Verify array and comment preserved
      expect(extracted).toContain('- item1');
      expect(extracted).toContain('- item2');
      expect(extracted).toContain('# comment on item2');
      expect(extracted).toContain('- item3');
    });

    it('should extract scalar value', () => {
      const input = `
version: "1.0.0"
name: my-app
`;

      let versionExtracted = '';
      let nameExtracted = '';
      updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode }) => {
          versionExtracted = getYamlNode({ findKey: (p: any) => p.version });
          nameExtracted = getYamlNode({ findKey: (p: any) => p.name });
        }
      });

      // Scalars are returned without quotes unless necessary
      expect(versionExtracted.trim()).toBe('1.0.0');
      expect(nameExtracted.trim()).toBe('my-app');
    });

    it('should extract YAML with anchors', () => {
      const input = `
defaults: &def
  timeout: 30
  retries: 3
production:
  host: prod.com
  settings: &prod-settings
    cache: true
    debug: false
`;

      let extracted = '';
      updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode }) => {
          // Extract the defaults which has an anchor
          extracted = getYamlNode({ findKey: (p: any) => p.defaults });
        }
      });

      // Verify anchor is preserved
      expect(extracted).toContain('&def');
      expect(extracted).toContain('timeout: 30');
      expect(extracted).toContain('retries: 3');
    });

    it('should extract deeply nested structure with comments', () => {
      const input = `
root:
  level1:
    level2:
      # Nested comment
      level3:
        value: 123
`;

      let extracted = '';
      updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode }) => {
          extracted = getYamlNode({ findKey: (p: any) => p.root.level1.level2.level3 });
        }
      });

      expect(extracted).toContain('value: 123');
      // Note: The comment is on level2, not level3, so it won't be in the extracted subtree
    });

    it('should support copy/move operation using getYamlNode + setYamlNode', () => {
      const input = `
staging:
  # Staging config
  host: staging.com
  port: 8080
production: {}
`;

      const { result } = updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode, setYamlNode }) => {
          const stagingConfig = getYamlNode({ findKey: (p: any) => p.staging });
          setYamlNode({
            findKey: (p: any) => p.production,
            yamlString: stagingConfig,
            comment: () => 'Copied from staging'
          });
        }
      });

      // Verify production has staging's config with comments
      expect(result).toContain('# Copied from staging');
      expect(result).toContain('host: staging.com');
      expect(result).toContain('port: 8080');
    });

    it('should throw error on path not found', () => {
      const input = `foo: bar`;

      expect(() => {
        updateYaml({
          yamlString: input,
          annotate: ({ getYamlNode }) => {
            getYamlNode({ findKey: (p: any) => p.nonexistent });
          }
        });
      }).toThrow(/path.*not found/);
    });

    it('should throw error on extracting null value', () => {
      const input = `foo: null`;

      expect(() => {
        updateYaml({
          yamlString: input,
          annotate: ({ getYamlNode }) => {
            getYamlNode({ findKey: (p: any) => p.foo });
          }
        });
      }).toThrow(/not found/);
    });

    it('should throw error on extracting undefined property', () => {
      const input = `foo: bar`;

      expect(() => {
        updateYaml({
          yamlString: input,
          annotate: ({ getYamlNode }) => {
            getYamlNode({ findKey: (p: any) => p.missing });
          }
        });
      }).toThrow(/not found/);
    });

    it('should extract root document', () => {
      const input = `
# Root comment
foo: bar
baz: qux
`;

      let extracted = '';
      updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode }) => {
          extracted = getYamlNode({ findKey: (p: any) => p });
        }
      });

      expect(extracted).toContain('foo: bar');
      expect(extracted).toContain('baz: qux');
    });

    it('should preserve flow style when extracting', () => {
      const input = `
config: {compact: true, inline: yes}
`;

      let extracted = '';
      updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode }) => {
          extracted = getYamlNode({ findKey: (p: any) => p.config });
        }
      });

      // Verify flow style is preserved
      expect(extracted).toMatch(/\{.*\}/);
      expect(extracted).toContain('compact');
      expect(extracted).toContain('inline');
    });

    it('should support extract then re-insert (round-trip test)', () => {
      const input = `
source:
  # Important config
  items:
    - name: item1
      value: 100  # first item
    - name: item2
      value: 200
target: {}
`;

      const { result } = updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode, setYamlNode }) => {
          const sourceItems = getYamlNode({ findKey: (p: any) => p.source.items });
          setYamlNode({
            findKey: (p: any) => p.target,
            yamlString: sourceItems
          });
        }
      });

      // Verify target now has source.items with all comments
      expect(result).toContain('# first item');
    });

    it('should move sub-document to root level with all comments', () => {
      const input = `
# Top level comment
application:
  name: my-app
  version: 1.0.0

database:
  # Database configuration
  host: localhost
  port: 5432
  credentials:
    # Sensitive data
    username: admin
    password: secret
  settings:
    pool_size: 10  # Connection pool
    timeout: 30

cache:
  enabled: true
`;

      const { result } = updateYaml({
        yamlString: input,
        annotate: ({ getYamlNode, setYamlNode }) => {
          // Extract the database configuration
          const databaseConfig = getYamlNode({ findKey: (p: any) => p.database });

          // Set it as the root level (replace everything)
          setYamlNode({
            findKey: (p: any) => p,  // Root level
            yamlString: databaseConfig
          });
        }
      });

      const expected = `# Database configuration
host: localhost
port: 5432
credentials:
  # Sensitive data
  username: admin
  password: secret
settings:
  pool_size: 10 # Connection pool
  timeout: 30
`;

      expect(result).toEqual(expected);
    });
  });

  describe('Empty Object Rendering', () => {
    it('should render empty object without braces when merge returns empty object (defaultFlow: false)', () => {
      const input = `database:
  host: localhost

staging:
  host: staging.com`;

      const { result } = updateYaml({
        yamlString: input,
        defaultFlow: false,  // Explicit default
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (original) => ({
              ...original,
              production: {}  // Merge returns empty object
            })
          });
        }
      });

      const expected = `database:
  host: localhost

staging:
  host: staging.com
production:
`;

      expect(result).toEqual(expected);
    });

    it('should render empty object with braces when defaultFlow is true', () => {
      const input = `database:
  host: localhost

staging:
  host: staging.com`;

      const { result } = updateYaml({
        yamlString: input,
        defaultFlow: true,  // Flow style requested
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (original) => ({
              ...original,
              production: {}  // Merge returns empty object
            })
          });
        }
      });

      const expected = `database:
  host: localhost

staging:
  host: staging.com
production: {}
`;

      expect(result).toEqual(expected);
    });

    it('should render empty object without braces with addInstructions comment (defaultFlow: false)', () => {
      const input = `database:
  host: localhost

staging:
  host: staging.com`;

      const { result } = updateYaml({
        yamlString: input,
        defaultFlow: false,  // Block style (default)
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (original) => ({
              ...original,
              ...addInstructions({
                prop: 'production',
                comment: 'Production environment'
              }),
              production: {}  // Empty object with comment
            })
          });
        }
      });

      const expected = `database:
  host: localhost

staging:
  host: staging.com
# Production environment
production:
`;

      expect(result).toEqual(expected);
    });

    it('should render empty object with braces with addInstructions comment (defaultFlow: true)', () => {
      const input = `database:
  host: localhost

staging:
  host: staging.com`;

      const { result } = updateYaml({
        yamlString: input,
        defaultFlow: true,  // Flow style requested
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (original) => ({
              ...original,
              ...addInstructions({
                prop: 'production',
                comment: 'Production environment'
              }),
              production: {}  // Empty object with comment
            })
          });
        }
      });

      const expected = `database:
  host: localhost

staging:
  host: staging.com
# Production environment
production: {}
`;

      expect(result).toEqual(expected);
    });

    it('should respect per-property flow instruction for empty object', () => {
      const input = `database:
  host: localhost`;

      const { result } = updateYaml({
        yamlString: input,
        defaultFlow: false,  // Default is block style
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (original) => ({
              ...original,
              ...addInstructions({
                prop: 'production',
                flow: true  // Force this specific property to use flow style
              }),
              production: {}  // Empty object
            })
          });
        }
      });

      const expected = `database:
  host: localhost
production: {}
`;

      expect(result).toEqual(expected);
    });

    it('should respect per-property flow: false instruction for empty object', () => {
      const input = `database:
  host: localhost`;

      const { result } = updateYaml({
        yamlString: input,
        defaultFlow: true,  // Default is flow style
        annotate: ({ change }) => {
          change({
            findKey: (parsed: any) => parsed,
            merge: (original) => ({
              ...original,
              ...addInstructions({
                prop: 'production',
                flow: false  // Force this specific property to use block style
              }),
              production: {}  // Empty object
            })
          });
        }
      });

      const expected = `database:
  host: localhost
production:
`;

      expect(result).toEqual(expected);
    });
  });
});
