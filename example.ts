/**
 * Example demonstrating @hiscojs/yaml-updater with comment manipulation
 */

import { updateYaml, addInstructions } from './src/index';

// Example 1: Adding comments via addInstructions
const example1 = () => {
  const yamlString = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
data:
  database: localhost
  cache: redis
`;

  const { result } = updateYaml({
    yamlString,
    annotate: ({ change }) => {
      change({
        findKey: (parsed: any) => parsed,
        merge: () => ({
          ...addInstructions({
            prop: 'data',
            comment: 'Application configuration data'
          }),
          data: {
            database: 'db.production.com',
            cache: 'redis.production.com'
          }
        })
      });
    }
  });

  console.log('Example 1 - Adding comment via addInstructions:');
  console.log(result);
};

// Example 2: Preserving existing comments
const example2 = () => {
  const yamlString = `
# Kubernetes Deployment Configuration
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  # Number of replicas
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: myapp:1.0
`;

  const { result } = updateYaml({
    yamlString,
    annotate: ({ change }) => {
      change({
        findKey: (parsed: any) => parsed.spec,
        merge: () => ({
          replicas: 3  // Change value, comments are preserved
        })
      });
    }
  });

  console.log('Example 2 - Preserving existing comments:');
  console.log(result);
};

// Example 3: Combining merge instructions with comments
const example3 = () => {
  const yamlString = `
spec:
  containers:
    - name: app
      image: myapp:1.0
    - name: sidecar
      image: sidecar:1.0
`;

  interface Spec {
    containers: Array<{ name: string; image: string; env?: Array<{ name: string; value: string }> }>;
  }

  const { result } = updateYaml({
    yamlString,
    annotate: ({ change }) => {
      change({
        findKey: (parsed: any) => parsed,
        merge: () => ({
          ...addInstructions({
            prop: 'spec',
            comment: 'Pod specification'
          }),
          spec: {
            ...addInstructions({
              prop: 'containers',
              mergeByName: true,
              comment: 'Container definitions merged by name'
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
          }
        })
      });
    }
  });

  console.log('Example 3 - Combining mergeByName with comments:');
  console.log(result);
};

// Example 4: Simple increment using originalValue
const example4 = () => {
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

  const { result } = updateYaml<Deployment>({
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

  console.log('Example 4 - Simple increment using originalValue:');
  console.log(result);
};

// Example 5: Using originalValue to preserve and extend configuration
const example5 = () => {
  const yamlString = `
spec:
  replicas: 2
  strategy: RollingUpdate
  minReadySeconds: 10
`;

  interface Config {
    spec: {
      replicas: number;
      strategy: string;
      minReadySeconds: number;
      maxUnavailable?: number;
    };
  }

  const { result } = updateYaml<Config>({
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

  console.log('Example 5 - Using originalValue to calculate dynamic values:');
  console.log(result);
};

// Example 6: Using originalValue with array operations
const example6 = () => {
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

  const { result } = updateYaml<Config>({
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

  console.log('Example 6 - Using originalValue with array transformations:');
  console.log(result);
};

// Run examples
if (require.main === module) {
  example1();
  console.log('\n---\n');
  example2();
  console.log('\n---\n');
  example3();
  console.log('\n---\n');
  example4();
  console.log('\n---\n');
  example5();
  console.log('\n---\n');
  example6();
}
