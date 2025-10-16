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
  annotate?: (annotator: {
    change: <L>(options: ChangeOptions<T, L>) => void;
  }) => void;
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

### Using `addInstructions` for Comments

```typescript
import { updateYaml, addInstructions } from '@hiscojs/yaml-updater';

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

## Related Packages

- [@hiscojs/object-updater](https://www.npmjs.com/package/@hiscojs/object-updater) - The underlying object manipulation library

## License

MIT

## Contributing

Issues and pull requests welcome!

## Repository

https://github.com/hisco/yaml-updater
