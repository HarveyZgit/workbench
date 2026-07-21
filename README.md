# Eden-Monorepo Practice

[emo3-practice](https://code.byted.org/web-solutions/emo3-practice)

[emo3-pnpm-workspace-practice](https://code.byted.org/web-solutions/emo3-pnpm-workspace-practice)

## install cli

```sh
npm install -g @ies/eden-monorepo@latest
```

## Create and add subprojects

```sh
emo init # equal to npx @byted/create@latest --emo, more details: https://edenx.bytedance.net/codesmith
emo create # equal to npx @byted/create@latest --emo-sub-prj
emo create --dir libs # Specify the libs directory, equal to npx @byted/create@latest --emo-sub-prj --dir libs
```

## local development

### Dependency installation

```sh
emo install
```

### script run

run in the root directory

```sh
emo start [workspace-name]
```

Run under the subproject path

```sh
emo start
emo build
emo test
```

For example: If you want to develop `apps/edenx`, put `emo start` in the corresponding subdirectory, and build automatically

The running priority is as follows

```json
// eden.monorepo.json
{
  "config": {
    "scriptName": {
      "test": ["test"],
      "build": ["build"],
      "start": ["build:watch", "dev", "start", "serve"]
    }
  }
}
```

### Build projects in batches

Run in the root directory to build all projects

```sh
emo run build # Run build all projects in the root directory, and only build the project under the subproject
emo run build --filter "@byted-emo/edenx..." # build @byted-emo/edenx and all its dependencies
emo run build --filter './packages/'         # build all projects under './package/'
emo run build --filter \!@byted-emo/edenx    # build all projects except @byted-emo/edenx
```

## Dependeny management

### Add Dependencies

```sh
emo add react # run under subproject
emo add react --filter @byted-emo/edenx # Run in the root directory
```

### Dependency reloading

```sh
emo exec 'rm -rf ./node_modules' --parallel
emo reset # Also clean up .eden-mono
```

### Dependency troubleshooting

```sh
emo run-pnpm why -r react
emo run-pnpm why -r react --filter "@byted-emo/edenx"
```

## CI/CD

### scm

Use `emo scm` in the root directory to trigger the `build.sh` of the subproject

```sh
# scm_build.sh
#!/bin/bash
set -e

echo "node version is " && node -v

npm install -g @ies/eden-monorepo@3.7.1 --registry https://bnpm.byted.org

emo scm
```

```json
// eden.mono.pipeline.json
{
  "$schema": "https://sf-unpkg-src.bytedance.net/@ies/eden-monorepo@3.7.1/lib/mono.pipeline.schema.json",
  "scene": {
    "scm": {
      "emo/demo/edenx": {
        "entries": ["@byted-emo/edenx"]
      }
    }
  }
}
```

```sh
# apps/edenx/build.sh
#!/bin/bash
set -e

npm run deploy
```

### codebase

```yaml
# .codebase/pipelines/partial.yaml
name: Partial Pipeline - Before Merge
trigger: change
jobs:
  emo-partial:
    image: hub.byted.org/base/ci_nodejs_22:297bea689b0966fcbdb2daff6b39ed6b
    steps:
      - name: Init
        commands:
          - npm config set registry https://bnpm.byted.org
          - npm install -g @ies/eden-monorepo@3.7.1
      - name: Pipeline
        commands:
          - emo pipeline --scene gitlab --trigger-branch create --target-branch $CI_EVENT_CHANGE_TARGET_BRANCH --revision origin/$CI_EVENT_CHANGE_TARGET_BRANCH
```

```json
// eden.mono.pipeline.json
{
  "$schema": "https://sf-unpkg-src.bytedance.net/@ies/eden-monorepo@3.7.1/lib/mono.pipeline.schema.json",
  "scene": {
    "gitlab": {
      "buildAffected": true,
      "testAffected": true
    }
  }
}
```

## updated version

### Upgrade pnpm version

```diff
// eden.monorepo.json
{
  "$schema": "https://sf-unpkg-src.bytedance.net/@ies/eden-monorepo@3.7.1/lib/monorepo.schema.json",
  "config": {
    "infraDir": "infra",
-   "pnpmVersion": "7.32.0",
+   "pnpmVersion": "10.12.1",
    "edenMonoVersion": "3.7.1",
  },
  "packages": [
    // ...
  ]
}
```

### Upgrade emo version

```diff
// eden.monorepo.json
{
- "$schema": "https://sf-unpkg-src.bytedance.net/@ies/eden-monorepo@3.0.0/lib/monorepo.schema.json",
+ "$schema": "https://sf-unpkg-src.bytedance.net/@ies/eden-monorepo@3.7.1/lib/monorepo.schema.json",
  "config": {
    "infraDir": "infra",
    "pnpmVersion": "10.12.1",
-   "edenMonoVersion": "3.0.0",
+   "edenMonoVersion": "3.7.1",
  },
  "packages": [
    // ...
  ]
}
```
