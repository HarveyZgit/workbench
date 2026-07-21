#!/bin/bash
set -e

echo "node version is " && node -v

source /etc/profile

npm install -g @ies/eden-monorepo@3.11.1 --registry https://bnpm.byted.org

emo scm
