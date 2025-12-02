import { updateYaml } from './src/index';

// Example 1: Simple header
console.log('=== Example 1: Simple Header ===');
const simpleHeaderExample = `
apiVersion: v1
kind: ConfigMap
data:
  database: localhost
`;

const { result: simpleResult } = updateYaml({
  yamlString: simpleHeaderExample,
  documentHeader: {
    type: 'simple',
    content: ['API Gateway configuration', 'Owner: platform-team']
  },
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed.data,
      merge: () => ({ database: 'db.production.com' })
    });
  }
});

console.log(simpleResult);

// Example 2: Multi-line bordered header
console.log('\n=== Example 2: Multi-line Bordered Header ===');
const multiLineExample = `
apiVersion: v1
kind: Service
metadata:
  name: my-service
`;

const { result: multiLineResult } = updateYaml({
  yamlString: multiLineExample,
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
      findKey: (parsed: any) => parsed.metadata,
      merge: (metadata) => ({ ...metadata, namespace: 'production' })
    });
  }
});

console.log(multiLineResult);

// Example 3: Raw header with custom styling
console.log('\n=== Example 3: Raw Header ===');
const rawHeaderExample = `
apiVersion: apps/v1
kind: Deployment
`;

const { result: rawResult } = updateYaml({
  yamlString: rawHeaderExample,
  documentHeader: {
    type: 'raw',
    content: `###
### Custom Deployment Config
### Managed by GitOps
###`
  },
  annotate: ({ change }) => {
    change({
      findKey: (parsed: any) => parsed,
      merge: (obj) => ({ ...obj, metadata: { name: 'my-app' } })
    });
  }
});

console.log(rawResult);

// Example 4: Extracting existing header
console.log('\n=== Example 4: Extract Existing Header ===');
const yamlWithHeader = `# Configuration File
# Version: 1.0
apiVersion: v1
kind: ConfigMap
`;

const { extractedHeader } = updateYaml({
  yamlString: yamlWithHeader,
  documentHeader: {
    type: 'simple',
    content: []
  }
});

console.log('Extracted header:', extractedHeader);

// Example 5: Replace existing header
console.log('\n=== Example 5: Replace Existing Header ===');
const { result: replacedResult } = updateYaml({
  yamlString: yamlWithHeader,
  documentHeader: {
    type: 'simple',
    content: ['Updated Configuration', 'Version: 2.0', 'Last modified: 2024']
  }
});

console.log(replacedResult);
