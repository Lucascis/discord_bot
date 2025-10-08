#!/bin/bash

# Discord Bot Service Mesh Deployment Script
# Deploys Istio service mesh with advanced enterprise features

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ISTIO_VERSION=${ISTIO_VERSION:-"1.20.0"}
NAMESPACE=${NAMESPACE:-"discord-bot"}
MONITORING_NAMESPACE=${MONITORING_NAMESPACE:-"istio-system"}

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi

    # Check istioctl
    if ! command -v istioctl &> /dev/null; then
        log_warning "istioctl not found, downloading..."
        download_istio
    fi

    # Check cluster access
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot access Kubernetes cluster"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

download_istio() {
    log_info "Downloading Istio ${ISTIO_VERSION}..."

    curl -L https://istio.io/downloadIstio | ISTIO_VERSION=${ISTIO_VERSION} sh -
    export PATH="$PWD/istio-${ISTIO_VERSION}/bin:$PATH"

    log_success "Istio downloaded and added to PATH"
}

install_istio() {
    log_info "Installing Istio control plane..."

    # Create istio-system namespace
    kubectl create namespace istio-system --dry-run=client -o yaml | kubectl apply -f -

    # Install Istio with custom configuration
    istioctl install --set values.defaultRevision=default -f istio-installation.yaml -y

    # Verify installation
    kubectl wait --for=condition=available deployment/istiod -n istio-system --timeout=600s

    log_success "Istio control plane installed successfully"
}

setup_observability() {
    log_info "Setting up observability stack..."

    # Install Prometheus
    kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-${ISTIO_VERSION}/samples/addons/prometheus.yaml

    # Install Grafana
    kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-${ISTIO_VERSION}/samples/addons/grafana.yaml

    # Install Jaeger
    kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-${ISTIO_VERSION}/samples/addons/jaeger.yaml

    # Install Kiali
    kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-${ISTIO_VERSION}/samples/addons/kiali.yaml

    # Wait for deployments
    kubectl wait --for=condition=available deployment/prometheus -n istio-system --timeout=300s
    kubectl wait --for=condition=available deployment/grafana -n istio-system --timeout=300s
    kubectl wait --for=condition=available deployment/jaeger -n istio-system --timeout=300s
    kubectl wait --for=condition=available deployment/kiali -n istio-system --timeout=300s

    log_success "Observability stack deployed"
}

deploy_service_mesh_policies() {
    log_info "Deploying service mesh policies..."

    # Apply service mesh policies
    kubectl apply -f service-mesh-policies.yaml

    # Wait for policies to be applied
    sleep 10

    log_success "Service mesh policies deployed"
}

configure_certificates() {
    log_info "Configuring certificates for mTLS..."

    # Create root certificate for the mesh
    openssl req -new -newkey rsa:4096 -days 365 -nodes -x509 \
        -subj "/C=US/ST=CA/L=San Francisco/O=Discord Bot/CN=Discord Bot Root CA" \
        -keyout root-key.pem -out root-cert.pem

    # Create intermediate certificate
    openssl req -new -newkey rsa:4096 -nodes \
        -subj "/C=US/ST=CA/L=San Francisco/O=Discord Bot/CN=Discord Bot Intermediate CA" \
        -keyout cert-chain.pem -out cert-chain.csr

    openssl x509 -req -in cert-chain.csr -CA root-cert.pem -CAkey root-key.pem \
        -CAcreateserial -out cert-chain.pem -days 365

    # Create secret for Istio
    kubectl create secret generic cacerts -n istio-system \
        --from-file=root-cert.pem \
        --from-file=cert-chain.pem \
        --from-file=root-key.pem \
        --dry-run=client -o yaml | kubectl apply -f -

    # Restart Istio to pick up new certificates
    kubectl rollout restart deployment/istiod -n istio-system
    kubectl wait --for=condition=available deployment/istiod -n istio-system --timeout=300s

    log_success "Certificates configured for mTLS"
}

enable_sidecar_injection() {
    log_info "Enabling sidecar injection for application namespace..."

    # Create application namespace with sidecar injection
    kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -
    kubectl label namespace ${NAMESPACE} istio-injection=enabled --overwrite

    log_success "Sidecar injection enabled for ${NAMESPACE} namespace"
}

setup_monitoring_dashboards() {
    log_info "Setting up monitoring dashboards..."

    # Create custom Grafana dashboards
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: discord-bot-dashboard
  namespace: istio-system
  labels:
    grafana_dashboard: "1"
data:
  discord-bot-service-mesh.json: |
    {
      "dashboard": {
        "title": "Discord Bot Service Mesh",
        "panels": [
          {
            "title": "Request Rate",
            "type": "graph",
            "targets": [
              {
                "expr": "sum(rate(istio_requests_total{destination_app=~\"gateway-service|api-service|audio-service|worker-service\"}[5m])) by (destination_app)"
              }
            ]
          },
          {
            "title": "Error Rate",
            "type": "graph",
            "targets": [
              {
                "expr": "sum(rate(istio_requests_total{destination_app=~\"gateway-service|api-service|audio-service|worker-service\",response_code!~\"2.*\"}[5m])) by (destination_app)"
              }
            ]
          },
          {
            "title": "Response Time P99",
            "type": "graph",
            "targets": [
              {
                "expr": "histogram_quantile(0.99, sum(rate(istio_request_duration_milliseconds_bucket{destination_app=~\"gateway-service|api-service|audio-service|worker-service\"}[5m])) by (destination_app, le))"
              }
            ]
          }
        ]
      }
    }
EOF

    log_success "Monitoring dashboards configured"
}

verify_installation() {
    log_info "Verifying service mesh installation..."

    # Check Istio components
    istioctl verify-install

    # Check proxy status
    istioctl proxy-status

    # Check configuration
    istioctl analyze --all-namespaces

    # Test mTLS
    kubectl exec -n istio-system deployment/istiod -- curl -s localhost:15014/debug/config_dump | grep -o '"mode":"STRICT"' | wc -l

    log_success "Service mesh verification completed"
}

setup_traffic_management() {
    log_info "Setting up advanced traffic management..."

    # Create traffic management policies
    cat <<EOF | kubectl apply -f -
apiVersion: networking.istio.io/v1beta1
kind: EnvoyFilter
metadata:
  name: circuit-breaker
  namespace: ${NAMESPACE}
spec:
  configPatches:
  - applyTo: HTTP_ROUTE
    match:
      context: SIDECAR_INBOUND
    patch:
      operation: MERGE
      value:
        route:
          timeout: 30s
          retry_policy:
            retry_on: "5xx,reset,connect-failure,refused-stream"
            num_retries: 3
            per_try_timeout: 10s
EOF

    log_success "Advanced traffic management configured"
}

print_access_info() {
    log_info "Service mesh deployed successfully!"
    echo
    echo "Access Information:"
    echo "=================="

    # Get ingress gateway URL
    INGRESS_HOST=$(kubectl get service istio-ingressgateway -n istio-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    INGRESS_PORT=$(kubectl get service istio-ingressgateway -n istio-system -o jsonpath='{.spec.ports[?(@.name=="http2")].port}')

    if [ -z "$INGRESS_HOST" ]; then
        INGRESS_HOST=$(kubectl get service istio-ingressgateway -n istio-system -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
    fi

    if [ -z "$INGRESS_HOST" ]; then
        INGRESS_HOST="localhost"
        log_warning "Could not determine ingress host, using localhost"
    fi

    echo "• Ingress Gateway: http://${INGRESS_HOST}:${INGRESS_PORT}"
    echo "• Kiali Dashboard: kubectl port-forward -n istio-system service/kiali 20001:20001"
    echo "• Grafana Dashboard: kubectl port-forward -n istio-system service/grafana 3000:3000"
    echo "• Jaeger Dashboard: kubectl port-forward -n istio-system service/jaeger 16686:16686"
    echo "• Prometheus: kubectl port-forward -n istio-system service/prometheus 9090:9090"
    echo
    echo "Useful Commands:"
    echo "==============="
    echo "• Check proxy status: istioctl proxy-status"
    echo "• View configuration: istioctl proxy-config cluster <pod-name> -n ${NAMESPACE}"
    echo "• Analyze configuration: istioctl analyze --all-namespaces"
    echo "• View metrics: kubectl top pods -n ${NAMESPACE}"
    echo
}

cleanup() {
    if [[ "${1:-}" == "cleanup" ]]; then
        log_warning "Cleaning up service mesh..."
        kubectl delete namespace ${NAMESPACE} --ignore-not-found=true
        istioctl uninstall --purge -y
        kubectl delete namespace istio-system --ignore-not-found=true
        log_success "Service mesh cleaned up"
        exit 0
    fi
}

main() {
    log_info "Starting Discord Bot Service Mesh Deployment"
    echo "=============================================="

    cleanup "$@"

    check_prerequisites
    install_istio
    setup_observability
    configure_certificates
    enable_sidecar_injection
    deploy_service_mesh_policies
    setup_traffic_management
    setup_monitoring_dashboards
    verify_installation
    print_access_info

    log_success "Service mesh deployment completed successfully!"
}

# Handle script arguments
if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
    echo "Discord Bot Service Mesh Deployment Script"
    echo
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  --help, -h     Show this help message"
    echo "  cleanup        Remove the service mesh installation"
    echo
    echo "Environment Variables:"
    echo "  ISTIO_VERSION           Istio version to install (default: 1.20.0)"
    echo "  NAMESPACE               Application namespace (default: discord-bot)"
    echo "  MONITORING_NAMESPACE    Monitoring namespace (default: istio-system)"
    echo
    exit 0
fi

# Run main function
main "$@"