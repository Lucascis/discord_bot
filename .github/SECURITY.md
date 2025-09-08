# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. Please report security issues privately.

### How to Report

1. **Do not** create a public GitHub issue for security vulnerabilities
2. Send an email to the project maintainers with details of the vulnerability
3. Include as much information as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- Initial response within 48 hours
- Regular updates on the progress of fixing the vulnerability
- Credit in security advisories (unless you prefer to remain anonymous)

## Security Measures

### Dependency Management

- Dependencies are automatically scanned for vulnerabilities using:
  - npm audit (high and critical severity)
  - Snyk security scanning
  - GitHub Dependabot alerts
- Automated dependency updates via Dependabot
- Regular security audits run daily

### Code Security

- Static code analysis using CodeQL
- Input sanitization for user-provided data
- Environment variable validation
- Secure secret management practices

### Infrastructure Security

- Docker images built with security best practices
- Minimal base images used where possible
- Regular security updates for base images
- Network isolation between services

## Security Best Practices for Contributors

1. **Never commit secrets** - Use environment variables
2. **Validate all inputs** - Especially user-provided data
3. **Keep dependencies updated** - Regularly update to patched versions
4. **Follow secure coding practices** - Review code for common vulnerabilities
5. **Test security features** - Include security-related test cases

## Known Security Considerations

- This Discord bot handles user messages and commands
- Redis is used for inter-service communication
- PostgreSQL stores persistent data including user preferences
- Lavalink processes audio streams from external sources

## Security Updates

Security patches will be released as soon as possible after a vulnerability is confirmed and fixed. Critical security updates may be released outside of the normal release cycle.