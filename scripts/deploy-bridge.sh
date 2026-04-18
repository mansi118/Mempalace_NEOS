#!/bin/bash
# Deploy Graphiti bridge to EC2.
#
# Usage:
#   ./scripts/deploy-bridge.sh <ec2-ip> <ssh-key-path> <anthropic-api-key> <bridge-api-key>
#
# Example:
#   ./scripts/deploy-bridge.sh 13.233.45.67 ~/.ssh/neos.pem sk-ant-xxx my-secret-bridge-key
#
# Prerequisites:
#   - EC2 instance running Ubuntu with Docker installed
#   - SSH key with access to the instance
#   - Port 8100 open in security group

set -euo pipefail

EC2_IP="${1:?Usage: $0 <ec2-ip> <ssh-key> <anthropic-key> <bridge-key>}"
SSH_KEY="${2:?Missing SSH key path}"
ANTHROPIC_KEY="${3:?Missing Anthropic API key}"
BRIDGE_KEY="${4:?Missing bridge API key}"

EC2_USER="ubuntu"
DEPLOY_DIR="/opt/palace"

echo "=== Deploying PALACE Graphiti Bridge to $EC2_IP ==="

# 1. Create deployment directory on EC2
echo "[1/6] Creating deployment directory..."
ssh -i "$SSH_KEY" "$EC2_USER@$EC2_IP" "sudo mkdir -p $DEPLOY_DIR/services && sudo chown -R $EC2_USER:$EC2_USER $DEPLOY_DIR"

# 2. Copy files
echo "[2/6] Copying files..."
scp -i "$SSH_KEY" docker-compose.yml "$EC2_USER@$EC2_IP:$DEPLOY_DIR/"
scp -i "$SSH_KEY" services/Dockerfile "$EC2_USER@$EC2_IP:$DEPLOY_DIR/services/"
scp -i "$SSH_KEY" services/graphiti_bridge.py "$EC2_USER@$EC2_IP:$DEPLOY_DIR/services/"
scp -i "$SSH_KEY" services/config.py "$EC2_USER@$EC2_IP:$DEPLOY_DIR/services/"
scp -i "$SSH_KEY" services/requirements.txt "$EC2_USER@$EC2_IP:$DEPLOY_DIR/services/"

# 3. Create .env file
echo "[3/6] Creating .env..."
ssh -i "$SSH_KEY" "$EC2_USER@$EC2_IP" "cat > $DEPLOY_DIR/.env << 'ENVEOF'
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
PALACE_BRIDGE_API_KEY=$BRIDGE_KEY
GRAPHITI_LLM_MODEL=claude-haiku-4-5-20251001
ENVEOF"

# 4. Build and start
echo "[4/6] Building and starting containers..."
ssh -i "$SSH_KEY" "$EC2_USER@$EC2_IP" "cd $DEPLOY_DIR && docker compose up -d --build"

# 5. Wait for health
echo "[5/6] Waiting for bridge to start..."
sleep 10

# 6. Verify
echo "[6/6] Verifying..."
HEALTH=$(ssh -i "$SSH_KEY" "$EC2_USER@$EC2_IP" "curl -s http://localhost:8100/health")
echo "Bridge health: $HEALTH"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Bridge URL: http://$EC2_IP:8100"
echo "FalkorDB Browser: http://$EC2_IP:3000"
echo ""
echo "Next steps:"
echo "  1. Set Convex env vars:"
echo "     npx convex env set GRAPHITI_BRIDGE_URL=http://$EC2_IP:8100"
echo "     npx convex env set PALACE_BRIDGE_API_KEY=$BRIDGE_KEY"
echo ""
echo "  2. Test from local:"
echo "     curl http://$EC2_IP:8100/health"
echo "     curl -X POST http://$EC2_IP:8100/ingest \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -H 'X-Palace-Key: $BRIDGE_KEY' \\"
echo "       -d '{\"palace_id\":\"neuraledge\",\"content\":\"test\"}'"
