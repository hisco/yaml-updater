# @hiscojs/yaml-updater

Type-safe, immutable YAML updates with comment preservation, multi-document support, and advanced array merging strategies.

Built on top of [@hiscojs/object-updater](https://www.npmjs.com/package/@hiscojs/object-updater) for powerful object manipulation capabilities.

## Installation

```bash
npm install @hiscojs/yaml-updater
```

## Quick Start

```typescript
import { updateYaml } from '@hiscojs/yaml-updater';

const yamlString = `
apiVersion: v1
kind: ConfigMap
data:
  database: localhost
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.data,
      merge: () => ({ database: 'db.production.com' })
    });
  }
});

console.log(result);
// apiVersion: v1
// kind: ConfigMap
// data:
//   database: db.production.com
```

## Features

- **Type-Safe**: Full TypeScript support with generic type parameters
- **Comment Preservation**: Automatically preserves existing YAML comments
- **Comment Manipulation**: Add, remove, or update comments programmatically
- **YAML Anchors & Aliases**: Create reusable content with anchors, aliases, and merge keys
- **Anchor Renaming**: Rename anchors and update all references document-wide
- **Schema-Level Instructions**: Define structure metadata separately from data (OpenAPI-style)
- **YAML vs JSON Formatting**: Control output format with `flow` and `flowItems` instructions
- **Per-Item Array Formatting**: Format each array item as JSON or YAML individually
- **Empty File Support**: Handle empty YAML strings gracefully
- **Multi-Document Support**: Handle YAML files with multiple documents
- **Immutable**: Original YAML strings are never modified
- **Advanced Array Merging**: Multiple strategies for merging arrays
- **Proxy-Based Path Tracking**: Automatic path detection
- **Formatting Preservation**: Maintains indentation and spacing

## API Reference

### `updateYaml<T>(options)`

Updates a YAML string immutably with type safety and comment preservation.

#### Parameters

```typescript
interface UpdateYamlOptions<T> {
  yamlString: string;
  selectDocument?: (yamlDocuments: Document[]) => number;
  schema?: YAMLSchema;  // Optional schema-level instructions
  annotate?: (annotator: {
    change: <L>(options: ChangeOptions<T, L>) => void;
  }) => void;
}

interface YAMLSchema {
  properties?: Record<string, SchemaProperty>;
}

interface SchemaProperty {
  // Comment instructions
  comment?: string;
  commentBefore?: string;
  commentAfter?: string;
  removeComment?: boolean;

  // Formatting instructions
  flow?: boolean;
  flowItems?: boolean[];

  // Anchor instructions
  anchor?: string;
  renameFrom?: string;
  alias?: string;
  mergeAnchor?: string;
  anchors?: Record<number, string>;
  aliases?: string[];

  // Nested structure
  type?: 'array';
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty[];
}
```

#### Returns

```typescript
interface YamlEdit<T> {
  result: string;           // Updated YAML string
  resultParsed: T;          // Parsed updated object
  originalParsed: T;        // Original parsed object
  comments: Array<{         // Comments that were added
    path: (string | number)[];
    comment: string;
  }>;
}
```

### `change<L>(options)`

Defines a single change operation with optional commenting.

```typescript
interface ChangeOptions<T, L> {
  findKey: (parsed: T) => L;
  merge: (originalValue: L) => Partial<L>;
  comment?: (previousComment?: string) => string | undefined;
}
```

## Basic Usage

### Simple Property Update

```typescript
const yamlString = `
server:
  host: localhost
  port: 3000
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.server,
      merge: () => ({ port: 8080 })
    });
  }
});

// server:
//   host: localhost
//   port: 8080
```

### Type-Safe Updates

```typescript
interface Config {
  server: {
    host: string;
    port: number;
  };
  database: {
    host: string;
    port: number;
  };
}

const { result, resultParsed } = updateYaml<Config>({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.server,  // Fully typed!
      merge: () => ({ port: 8080 })
    });
  }
});

console.log(resultParsed.server.port);  // Type-safe access
```

## Comment Management

### Adding Comments

```typescript
const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.spec,
      merge: () => ({ replicas: 3 }),
      comment: () => 'Scaled to 3 replicas for high availability'
    });
  }
});

// spec:
//   # Scaled to 3 replicas for high availability
//   replicas: 3
```

### Dynamic Comments

```typescript
const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.spec,
      merge: (originalValue) => ({
        replicas: originalValue.replicas * 2
      }),
      comment: (prevComment) =>
        `Scaled from ${originalValue.replicas} to ${originalValue.replicas * 2}`
    });
  }
});
```

### Using `addInstructions`

The `addInstructions` helper provides advanced control over properties including comments, merge strategies, and formatting:

```typescript
import { updateYaml, addInstructions } from '@hiscojs/yaml-updater';

// Available options:
addInstructions({
  prop: 'propertyName',           // Property to apply instructions to

  // Comment options:
  comment: 'Comment text',        // Add block comment above the property
  removeComment: true,            // Remove existing comment
  commentBefore: 'Text',          // Alternative to comment (same as comment)
  commentAfter: 'Text',           // Add inline comment (same line as property)

  // Array merge strategies:
  mergeByContents: true,          // Deduplicate by deep equality
  mergeByName: true,              // Merge by 'name' property
  mergeByProp: 'customProp',      // Merge by custom property
  deepMerge: true,                // Deep merge nested objects

  // Formatting options (YAML-specific):
  flow: true,                     // true = JSON format, false = YAML format
  flowItems: [true, false, true], // Per-item format for arrays
  hideNull: true                   // Hide null values (renders as "key:" not "key: null")
})
```

**Example with comments:**
```typescript
const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'data',
          comment: 'Configuration data section'
        }),
        data: {
          key: 'value'
        }
      })
    });
  }
});

// # Configuration data section
// data:
//   key: value
```

**Example with inline comments (commentAfter):**
```typescript
const { result } = updateYaml({
  yamlString: '',
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'enabled',
          commentAfter: 'toggle deployment'
        }),
        enabled: null,  // null values with inline comments render as "enabled: # comment"
        ...addInstructions({
          prop: 'replicas',
          commentAfter: 'number of replicas'
        }),
        replicas: 3  // Non-null values render as "replicas: 3 # comment"
      })
    });
  }
});

// enabled: # toggle deployment
// replicas: 3 # number of replicas
```

**Note on inline comments with objects:**
When a property has an object/array value (not a scalar), the inline comment appears as a block comment at the start of the content:

```typescript
const { result } = updateYaml({
  yamlString: '',
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'metadata',
          commentAfter: 'metadata comment'
        }),
        metadata: {
          name: 'test'
        }
      })
    });
  }
});

// metadata:
//   # metadata comment
//   name: test
```

**Example with hideNull:**
```typescript
const { result } = updateYaml({
  yamlString: stringify({
    charts: { sealedSecrets: {} },
    sealedSecrets: null
  }),
  annotate: ({ change }) => {
    change({
      findKey: (obj) => obj.charts.sealedSecrets,
      merge: () => ({
        ...addInstructions({
          prop: 'enabled',
          commentAfter: 'toggle deployment',
          hideNull: true  // Hides null, shows "enabled:" not "enabled: null"
        }),
        enabled: null
      })
    });

    change({
      findKey: (obj) => obj,
      merge: () => ({
        ...addInstructions({
          prop: 'sealedSecrets',
          hideNull: true  // Hides value, shows "sealedSecrets:" not "sealedSecrets: null"
        }),
        sealedSecrets: null
      })
    });
  }
});

// charts:
//   sealedSecrets:
//     enabled: # toggle deployment
// sealedSecrets:
```

### Removing Comments

```typescript
const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'data',
          removeComment: true
        }),
        data: { key: 'value' }
      })
    });
  }
});
```

## Array Merging Strategies

### `mergeByContents` - Deduplicate by Deep Equality

```typescript
const yamlString = `
items:
  - item1
  - item2
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'items',
          mergeByContents: true
        }),
        items: ['item2', 'item3']  // item2 deduplicated
      })
    });
  }
});

// items:
//   - item1
//   - item2
//   - item3
```

### `mergeByName` - Merge by Name Property

```typescript
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

const { result } = updateYaml<PodSpec>({
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
          { name: 'app', image: 'myapp:2.0' }  // Updates 'app' container
        ]
      })
    });
  }
});

// spec:
//   containers:
//     - name: app
//       image: myapp:2.0      # Updated
//     - name: sidecar
//       image: sidecar:1.0    # Preserved
```

### `mergeByProp` - Merge by Custom Property

```typescript
const yamlString = `
services:
  - serviceId: api
    url: http://api.local
  - serviceId: db
    url: postgres://db.local
`;

const { result } = updateYaml({
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
          { serviceId: 'api', url: 'https://api.prod' }
        ]
      })
    });
  }
});
```

### `deepMerge` - Deep Merge Nested Objects

```typescript
const yamlString = `
configs:
  - name: database
    settings:
      timeout: 30
      pool: 10
      ssl: true
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'configs',
          mergeByName: true,
          deepMerge: true
        }),
        configs: [
          {
            name: 'database',
            settings: { timeout: 60 }  // Only update timeout
          }
        ]
      })
    });
  }
});

// configs:
//   - name: database
//     settings:
//       timeout: 60    # Updated
//       pool: 10       # Preserved
//       ssl: true      # Preserved
```

## Using `originalValue`

Access original values to make conditional updates:

```typescript
const yamlString = `
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 2
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.spec,
      merge: (originalValue) => ({
        replicas: originalValue.replicas + 1  // Increment by 1
      }),
      comment: () => `Scaled from ${originalValue.replicas} to ${originalValue.replicas + 1} replicas`
    });
  }
});

// spec:
//   # Scaled from 2 to 3 replicas
//   replicas: 3
```

### Version Bumping

```typescript
const yamlString = `
version: "1.2.3"
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: (originalValue) => {
        const [major, minor, patch] = originalValue.version.split('.').map(Number);
        return {
          version: `${major}.${minor}.${patch + 1}`
        };
      }
    });
  }
});

// version: "1.2.4"
```

## Multi-Document YAML

### Select Document by Index

```typescript
const yamlString = `---
apiVersion: v1
kind: ConfigMap
data:
  key1: value1
---
apiVersion: v1
kind: Secret
data:
  key2: value2`;

const { result } = updateYaml({
  yamlString,
  selectDocument: () => 1,  // Select second document (Secret)
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.data,
      merge: () => ({ key2: 'updated' })
    });
  }
});
```

### Select Document by Content

```typescript
const { result } = updateYaml({
  yamlString,
  selectDocument: (docs) => {
    return docs.findIndex(doc => {
      const parsed = doc.toJSON();
      return parsed.kind === 'Deployment';
    });
  },
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.spec,
      merge: () => ({ replicas: 5 })
    });
  }
});
```

## Real-World Examples

### Kubernetes Deployment Update

```typescript
const deploymentYaml = `
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

interface K8sDeployment {
  apiVersion: string;
  kind: string;
  metadata: { name: string };
  spec: {
    replicas: number;
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
          env?: Array<{ name: string; value: string }>;
        }>;
      };
    };
  };
}

const { result } = updateYaml<K8sDeployment>({
  yamlString: deploymentYaml,
  annotate: ({ change }) => {
    // Scale replicas
    change({
      findKey: (parsed) => parsed.spec,
      merge: () => ({ replicas: 3 }),
      comment: () => 'Scaled to 3 replicas for high availability'
    });

    // Update container image
    change({
      findKey: (parsed) => parsed.spec.template.spec,
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
          }
        ]
      }),
      comment: () => 'Updated to production environment'
    });
  }
});
```

### ConfigMap Updates

```typescript
const configMapYaml = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  database_host: localhost
  cache_enabled: "false"
`;

const { result } = updateYaml({
  yamlString: configMapYaml,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.data,
      merge: () => ({
        database_host: 'db.production.com',
        cache_enabled: 'true',
        redis_host: 'redis.production.com'
      }),
      comment: () => 'Updated for production environment'
    });
  }
});

// apiVersion: v1
// kind: ConfigMap
// metadata:
//   name: app-config
// data:
//   # Updated for production environment
//   database_host: db.production.com
//   cache_enabled: "true"
//   redis_host: redis.production.com
```

### Helm Values Update

```typescript
const valuesYaml = `
replicaCount: 1

image:
  repository: myapp
  tag: "1.0.0"
  pullPolicy: IfNotPresent

resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 100m
    memory: 128Mi
`;

const { result } = updateYaml({
  yamlString: valuesYaml,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: (original) => ({
        replicaCount: 3,
        image: {
          ...original.image,
          tag: '2.0.0'
        }
      })
    });

    change({
      findKey: (parsed) => parsed.resources.limits,
      merge: () => ({
        cpu: '500m',
        memory: '512Mi'
      }),
      comment: () => 'Increased for production workload'
    });
  }
});
```

## YAML Anchors and Aliases

YAML anchors (`&anchor-name`) and aliases (`*anchor-name`) allow you to reuse content across your YAML document, reducing duplication and ensuring consistency.

### Basic Anchor and Alias

```typescript
const { result } = updateYaml({
  yamlString: '',
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'defaults',
          anchor: 'default-config'
        }),
        defaults: {
          timeout: 30,
          retries: 3
        },
        ...addInstructions({
          prop: 'production',
          alias: 'default-config'
        }),
        production: {}
      })
    });
  }
});

// Output:
// defaults: &default-config
//   timeout: 30
//   retries: 3
// production: *default-config
```

### Merge Keys - Extend and Override

Use `mergeAnchor` to inherit properties from an anchor while adding or overriding specific values:

```typescript
const { result } = updateYaml({
  yamlString: '',
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'defaults',
          anchor: 'base-config'
        }),
        defaults: {
          timeout: 30,
          retries: 3,
          logLevel: 'info'
        },
        ...addInstructions({
          prop: 'production',
          mergeAnchor: 'base-config'
        }),
        production: {
          logLevel: 'error',    // Override
          monitoring: true      // Add new
        }
      })
    });
  }
});

// Output:
// defaults: &base-config
//   timeout: 30
//   retries: 3
//   logLevel: info
// production:
//   <<: *base-config
//   logLevel: error
//   monitoring: true
```

### Array Item Anchors and Aliases

Apply anchors and aliases to specific array items:

```typescript
const { result } = updateYaml({
  yamlString: '',
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'environments',
          anchors: { 0: 'prod-env' },
          aliases: [undefined, 'prod-env', 'prod-env']
        }),
        environments: [
          { name: 'production', cpu: '1000m', memory: '2Gi' },
          { name: 'staging' },
          { name: 'qa' }
        ]
      })
    });
  }
});

// Output:
// environments:
//   - &prod-env
//     name: production
//     cpu: 1000m
//     memory: 2Gi
//   - *prod-env
//   - *prod-env
```

### Renaming Anchors

Rename an anchor and automatically update all references throughout the document:

```typescript
const yamlString = `
defaults: &old-name
  timeout: 30
api:
  <<: *old-name
worker:
  <<: *old-name
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'defaults',
          anchor: 'new-name',
          renameFrom: 'old-name'
        })
      })
    });
  }
});

// Output:
// defaults: &new-name
//   timeout: 30
// api:
//   <<: *new-name
// worker:
//   <<: *new-name
```

### Schema-Level Instructions

For complex documents, define instructions at the schema level instead of inline. This separates formatting concerns (anchors, comments, flow style) from data structure.

**Key Concept**: The YAML updater schema defines **how to format** your YAML (anchors, comments, styling), while your OpenAPI schema defines **what the data structure is** (types, validation). These are complementary but separate concerns.

**When to use schema-level instructions:**
- You have a consistent structure that needs the same formatting applied repeatedly
- You're working with OpenAPI/JSON Schema and want to layer formatting on top
- You want to reuse formatting rules across multiple `updateYaml` calls
- You need to maintain separation between data structure (OpenAPI) and presentation (YAML formatting)

**Basic Example:**

```typescript
const { result } = updateYaml({
  yamlString: '',
  schema: {
    properties: {
      server: {
        anchor: 'server-config',
        comment: 'Server configuration',
        properties: {
          host: { commentBefore: 'Production host' }
        }
      },
      database: {
        mergeAnchor: 'server-config',
        comment: 'Database inherits server config'
      },
      cache: {
        mergeAnchor: 'server-config'
      }
    }
  },
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed,
      merge: () => ({
        server: { host: 'localhost', port: 8080 },
        database: { dbName: 'myapp' },
        cache: { ttl: 3600 }
      })
    });
  }
});

// Output:
// # Server configuration
// server: &server-config
//   # Production host
//   host: localhost
//   port: 8080
// # Database inherits server config
// database:
//   <<: *server-config
//   dbName: myapp
// cache:
//   <<: *server-config
//   ttl: 3600
```

**Schema for Array Items:**

```typescript
const { result } = updateYaml({
  yamlString: '',
  schema: {
    properties: {
      templates: {
        type: 'array',
        items: [
          { anchor: 'template-1', comment: 'First template' },
          { anchor: 'template-2' }
        ]
      },
      instances: {
        type: 'array',
        items: [
          { alias: 'template-1' },
          { alias: 'template-2' },
          { alias: 'template-1' }
        ]
      }
    }
  },
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed,
      merge: () => ({
        templates: [
          { name: 'basic', timeout: 30 },
          { name: 'advanced', timeout: 60 }
        ],
        instances: [{}, {}, {}]
      })
    });
  }
});

// Output:
// templates:
//   # First template
//   - &template-1
//     name: basic
//     timeout: 30
//   - &template-2
//     name: advanced
//     timeout: 60
// instances:
//   - *template-1
//   - *template-2
//   - *template-1
```

**Priority: Inline `addInstructions` overrides schema:**

```typescript
const { result } = updateYaml({
  yamlString: '',
  schema: {
    properties: {
      server: {
        anchor: 'server-config',
        comment: 'From schema'
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
          comment: 'From addInstructions'  // This takes priority
        }),
        server: { host: 'localhost' }
      })
    });
  }
});

// Output:
// # From addInstructions
// server: &override-anchor
//   host: localhost
```

### Real-World Example: Kubernetes Resource Sharing

```typescript
const { result } = updateYaml({
  yamlString: '',
  schema: {
    properties: {
      resourceDefaults: {
        anchor: 'default-resources',
        comment: 'Default resource limits'
      },
      frontend: {
        properties: {
          resources: { mergeAnchor: 'default-resources' }
        }
      },
      backend: {
        properties: {
          resources: { mergeAnchor: 'default-resources' }
        }
      },
      worker: {
        properties: {
          resources: { mergeAnchor: 'default-resources' }
        }
      }
    }
  },
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed,
      merge: () => ({
        resourceDefaults: {
          limits: { cpu: '500m', memory: '512Mi' },
          requests: { cpu: '100m', memory: '128Mi' }
        },
        frontend: {
          replicas: 3,
          resources: { limits: { cpu: '1000m' } }  // Override CPU
        },
        backend: {
          replicas: 2,
          resources: {}  // Use defaults
        },
        worker: {
          replicas: 5,
          resources: { requests: { memory: '256Mi' } }  // Override memory
        }
      })
    });
  }
});

// Output:
// # Default resource limits
// resourceDefaults: &default-resources
//   limits:
//     cpu: 500m
//     memory: 512Mi
//   requests:
//     cpu: 100m
//     memory: 128Mi
// frontend:
//   replicas: 3
//   resources:
//     <<: *default-resources
//     limits:
//       cpu: 1000m
// backend:
//   replicas: 2
//   resources:
//     <<: *default-resources
// worker:
//   replicas: 5
//   resources:
//     <<: *default-resources
//     requests:
//       memory: 256Mi
```

### Using with OpenAPI/JSON Schema

If you already have an OpenAPI specification or JSON Schema defining your data structure, you can create a complementary YAML updater schema to define formatting:

```typescript
// Your OpenAPI spec defines the data structure
const openApiSpec = {
  components: {
    schemas: {
      ServerConfig: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          port: { type: 'number' },
          timeout: { type: 'number' }
        }
      }
    }
  }
};

// YAML updater schema defines the formatting (separate concern)
const yamlFormattingSchema = {
  properties: {
    defaultServer: {
      anchor: 'server-config',
      comment: 'Default server configuration'
    },
    productionServer: {
      mergeAnchor: 'server-config',
      comment: 'Production overrides defaults'
    },
    stagingServer: {
      mergeAnchor: 'server-config',
      comment: 'Staging overrides defaults'
    }
  }
};

// Use both together
const { result } = updateYaml({
  yamlString,
  schema: yamlFormattingSchema,  // How to format
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        // Data validated against OpenAPI schema
        defaultServer: { host: 'localhost', port: 8080, timeout: 30 },
        productionServer: { host: 'prod.example.com', timeout: 60 },
        stagingServer: { host: 'staging.example.com' }
      })
    });
  }
});

// Output:
// # Default server configuration
// defaultServer: &server-config
//   host: localhost
//   port: 8080
//   timeout: 30
// # Production overrides defaults
// productionServer:
//   <<: *server-config
//   host: prod.example.com
//   timeout: 60
// # Staging overrides defaults
// stagingServer:
//   <<: *server-config
//   host: staging.example.com
```

**Benefits of this approach:**
- **Separation of concerns**: OpenAPI defines structure/types, YAML schema defines formatting
- **Reusability**: Define formatting schema once, reuse across multiple updates
- **Validation + Presentation**: Combine OpenAPI validation with YAML formatting
- **Maintainability**: Changes to data structure (OpenAPI) don't affect formatting rules

### Anchor Instructions Reference

All anchor-related options in `addInstructions`:

```typescript
addInstructions({
  prop: 'propertyName',

  // Create an anchor on this property
  anchor: 'anchor-name',

  // Rename existing anchor globally (use with anchor)
  renameFrom: 'old-anchor-name',

  // Create simple alias (replaces entire value)
  alias: 'anchor-name',

  // Merge with anchor (allows overrides)
  mergeAnchor: 'anchor-name',

  // Anchors for array items (by index)
  anchors: { 0: 'first-item', 2: 'third-item' },

  // Aliases for array items (by position)
  aliases: ['anchor-1', 'anchor-2', 'anchor-1']
})
```

## Advanced Features

### Multiple Changes

Apply multiple changes in a single update:

```typescript
const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.database,
      merge: () => ({ host: 'db.prod.com' })
    });

    change({
      findKey: (parsed) => parsed.cache,
      merge: () => ({ host: 'cache.prod.com' })
    });

    change({
      findKey: (parsed) => parsed.api,
      merge: () => ({ host: 'api.prod.com' })
    });
  }
});
```

### Conditional Updates

```typescript
const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.spec,
      merge: (originalValue) => {
        const newReplicas = originalValue.replicas < 3
          ? originalValue.replicas * 2
          : originalValue.replicas;

        return { replicas: newReplicas };
      },
      comment: (prevComment) =>
        originalValue.replicas < 3
          ? `Scaled from ${originalValue.replicas} to ${newReplicas}`
          : prevComment  // Keep existing comment
    });
  }
});
```

### Preserve and Extend

```typescript
const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.spec,
      merge: (originalValue) => ({
        ...originalValue,                    // Preserve all existing
        replicas: originalValue.replicas + 1, // Update one field
        newField: 'added'                    // Add new field
      })
    });
  }
});
```

## Comment Preservation

Comments are automatically preserved:

```typescript
const yamlString = `
# Application configuration
apiVersion: v1
kind: ConfigMap
metadata:
  # Metadata section
  name: my-config
data:
  # Database configuration
  database: localhost
  # Cache configuration
  cache: redis
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.data,
      merge: () => ({ database: 'db.prod.com' })
    });
  }
});

// All comments are preserved!
// # Application configuration
// apiVersion: v1
// kind: ConfigMap
// metadata:
//   # Metadata section
//   name: my-config
// data:
//   # Database configuration
//   database: db.prod.com
//   # Cache configuration
//   cache: redis
```

## Formatting Preservation

Indentation and spacing are maintained:

```typescript
const yamlString = `
server:
  host: localhost
  port: 3000


database:
  host: localhost
  port: 5432
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.server,
      merge: () => ({ port: 8080 })
    });
  }
});

// Blank lines and indentation preserved
// server:
//   host: localhost
//   port: 8080
//
//
// database:
//   host: localhost
//   port: 5432
```

## YAML vs JSON Formatting

### Control Output Format with `flow` Instruction

The `flow` instruction allows you to control whether properties are formatted as JSON (flow style) or YAML (block style):

```typescript
import { updateYaml, addInstructions } from '@hiscojs/yaml-updater';

const yamlString = `
config:
  name: myapp
`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.config,
      merge: () => ({
        name: 'myapp',
        // YAML block style (default)
        ...addInstructions({
          prop: 'settings',
          flow: false
        }),
        settings: {
          debug: true,
          timeout: 30
        },
        // JSON flow style
        ...addInstructions({
          prop: 'metadata',
          flow: true
        }),
        metadata: { version: '1.0', env: 'prod' },
        // JSON flow style for arrays
        ...addInstructions({
          prop: 'tags',
          flow: true
        }),
        tags: ['tag1', 'tag2', 'tag3']
      })
    });
  }
});

// Output:
// config:
//   name: myapp
//   settings:           # YAML block style (multi-line)
//     debug: true
//     timeout: 30
//   metadata: { version: "1.0", env: prod }  # JSON flow style (single-line)
//   tags: [ tag1, tag2, tag3 ]               # JSON flow style (single-line)
```

### Control Individual Array Items with `flowItems`

For fine-grained control, use `flowItems` to specify the format of each array item individually:

```typescript
const yamlString = `
items: []
`;

const { result } = updateYaml({
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

// Output:
// items:
//   - { id: 1, name: first }   # JSON format
//   - id: 2                     # YAML format
//     name: second
//   - { id: 3, name: third }    # JSON format
```

### Mixed JSON and YAML Example

```typescript
const { result } = updateYaml({
  yamlString: 'jsons: []',
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        ...addInstructions({
          prop: 'jsons',
          flowItems: [true, false]  // First: JSON, Second: YAML
        }),
        jsons: [
          {},           // Empty object in JSON
          { key: 1 }    // Object with data in YAML
        ]
      })
    });
  }
});

// Output:
// jsons:
//   - {}          # JSON format (compact)
//   - key: 1      # YAML format (expanded)
```

### When to Use Flow vs Block Style

**Use Flow Style (JSON) when:**
- Properties have simple, short values
- You want compact, single-line formatting
- The property contains metadata or configuration that benefits from being compact
- Empty objects or simple arrays

**Use Block Style (YAML) when:**
- Properties have complex nested structures
- You want readable, multi-line formatting
- The property contains important configuration that should be easy to read
- Large objects or arrays with many items

### Combining `flow` with Comments

```typescript
const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed.config,
      merge: () => ({
        ...addInstructions({
          prop: 'metadata',
          comment: 'Compact JSON metadata',
          flow: true
        }),
        metadata: { version: '1.0', env: 'prod' },
        ...addInstructions({
          prop: 'settings',
          comment: 'Detailed YAML settings',
          flow: false
        }),
        settings: {
          debug: true,
          timeout: 30
        }
      })
    });
  }
});

// Output:
// config:
//   # Compact JSON metadata
//   metadata: { version: "1.0", env: prod }
//   # Detailed YAML settings
//   settings:
//     debug: true
//     timeout: 30
```

## Writing to Empty Files

The library handles empty YAML strings gracefully, treating them as empty objects:

```typescript
const { result } = updateYaml({
  yamlString: '',  // Empty string
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

// Output:
// apiVersion: v1
// kind: ConfigMap
// data:
//   key: value
```

## Comment Placement

Comments are always placed **above** the property they describe:

```typescript
const { result } = updateYaml({
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

// Output:
// # Configuration data
// data:
//   database: localhost
//   cache: redis
```

## Best Practices

### 1. Use Type Parameters

```typescript
// ✅ Good - Type safe
const { result } = updateYaml<K8sDeployment>({ ... });

// ❌ Avoid - No type safety
const { result } = updateYaml({ ... });
```

### 2. Leverage `originalValue`

```typescript
// ✅ Good - Conditional based on original
merge: (originalValue) => ({
  replicas: originalValue.replicas + 1
})

// ❌ Avoid - Hardcoded without context
merge: () => ({ replicas: 3 })
```

### 3. Use Merge Strategies for Arrays

```typescript
// ✅ Good - Explicit merge strategy
...addInstructions({
  prop: 'containers',
  mergeByName: true
})

// ❌ Avoid - Array replacement
containers: newContainers  // Loses existing items
```

### 4. Add Meaningful Comments

```typescript
// ✅ Good - Descriptive comment
comment: () => 'Scaled to 3 replicas for high availability'

// ❌ Avoid - Obvious or missing comments
comment: () => 'Updated replicas'
```

### 5. Handle Multi-Document YAMLs

```typescript
// ✅ Good - Explicit document selection
selectDocument: (docs) => {
  return docs.findIndex(doc =>
    doc.toJSON().kind === 'Deployment'
  );
}

// ❌ Avoid - Assuming single document
// (works but fails silently with multi-doc)
```

## Error Handling

The library will throw descriptive errors for invalid YAML:

```typescript
try {
  const { result } = updateYaml({
    yamlString: invalidYaml,
    annotate: ({ change }) => { ... }
  });
} catch (error) {
  console.error('YAML parsing failed:', error.message);
}
```

## Performance Considerations

- **Large Files**: YAML parsing is memory-intensive. Consider streaming for very large files (>10MB).
- **Many Changes**: Each `change()` call creates proxies and performs deep cloning. Batch related changes when possible.
- **Comment Operations**: Adding/removing comments requires AST manipulation. Minimal performance impact for normal use.

## Dependencies

- `yaml`: YAML 1.2 parser and stringifier
- `deep-diff`: Deep object diffing
- `@hiscojs/object-updater`: Core object manipulation with type-safe updates

## Property Ordering

### How Key Order Works

The YAML updater determines property order based on **merge object property order**, not schema order.

**For new files (empty YAML):**
Keys appear in the exact order they are defined in your merge object:

```typescript
const { result } = updateYaml({
  yamlString: '',
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        apiVersion: 'v1',           // 1st
        kind: 'ConfigMap',          // 2nd
        metadata: { name: 'test' }, // 3rd
        data: { key: 'value' }      // 4th
      })
    });
  }
});

// Output follows merge object order:
// apiVersion: v1
// kind: ConfigMap
// metadata:
//   name: test
// data:
//   key: value
```

**For existing files:**
- Existing keys maintain their original order (preserved from source YAML)
- New keys are appended in the order they appear in the merge object

```typescript
const yamlString = `kind: ConfigMap
apiVersion: v1`;

const { result } = updateYaml({
  yamlString,
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        metadata: { name: 'test' },  // New
        data: { key: 'value' }       // New
      })
    });
  }
});

// Output preserves original order and appends new keys:
// kind: ConfigMap        (existing, order preserved)
// apiVersion: v1         (existing, order preserved)
// metadata:              (new, added in merge order)
//   name: test
// data:                  (new, added in merge order)
//   key: value
```

### Schema Does NOT Control Ordering

The `schema` parameter is used for **metadata** (comments, formatting, anchors), **not for ordering**:

```typescript
const { result } = updateYaml({
  yamlString: '',
  schema: {
    properties: {
      apiVersion: { comment: 'API version' },
      kind: { comment: 'Resource type' }
    }
  },
  annotate: ({ change }) => {
    change({
      findKey: (parsed) => parsed,
      merge: () => ({
        // Order comes from HERE, not from schema
        kind: 'ConfigMap',
        apiVersion: 'v1'
      })
    });
  }
});

// Output follows merge object order with schema comments:
// # Resource type
// kind: ConfigMap
// # API version
// apiVersion: v1
```

### Best Practices for Ordering

**✅ Control order explicitly via merge object:**

```typescript
// Good: Explicit, predictable order
merge: () => ({
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: { name: 'test' },
  data: { key: 'value' }
})
```

**✅ Use helper functions for consistent ordering:**

```typescript
function createK8sResource(kind: string, name: string, data: any) {
  return {
    apiVersion: 'v1',
    kind,
    metadata: { name },
    data
  };
}

merge: () => createK8sResource('ConfigMap', 'my-config', { key: 'value' })
```

**✅ Nested properties also follow merge object order:**

```typescript
merge: () => ({
  metadata: {
    name: 'test',           // 1st in metadata
    namespace: 'default',   // 2nd in metadata
    labels: { app: 'myapp' } // 3rd in metadata
  }
})

// Output:
// metadata:
//   name: test
//   namespace: default
//   labels:
//     app: myapp
```

## Related Packages

- [@hiscojs/object-updater](https://www.npmjs.com/package/@hiscojs/object-updater) - The underlying object manipulation library

## License

MIT

## Contributing

Issues and pull requests welcome!

## Repository

https://github.com/hisco/yaml-updater
