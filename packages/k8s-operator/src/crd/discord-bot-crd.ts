/**
 * Discord Bot Custom Resource Definitions
 * Kubernetes CRDs for managing Discord Bot instances
 */

export const DiscordBotCRD = {
  apiVersion: 'apiextensions.k8s.io/v1',
  kind: 'CustomResourceDefinition',
  metadata: {
    name: 'discordbots.music.io',
    labels: {
      'app.kubernetes.io/name': 'discord-bot-operator',
      'app.kubernetes.io/component': 'crd'
    }
  },
  spec: {
    group: 'music.io',
    versions: [
      {
        name: 'v1alpha1',
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  // Bot Configuration
                  botToken: {
                    type: 'string',
                    description: 'Discord bot token secret reference'
                  },
                  applicationId: {
                    type: 'string',
                    description: 'Discord application ID'
                  },

                  // Scaling Configuration
                  scaling: {
                    type: 'object',
                    properties: {
                      enabled: {
                        type: 'boolean',
                        default: true
                      },
                      minReplicas: {
                        type: 'integer',
                        minimum: 1,
                        default: 2
                      },
                      maxReplicas: {
                        type: 'integer',
                        minimum: 1,
                        default: 10
                      },
                      targetCPUUtilization: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 100,
                        default: 70
                      },
                      targetMemoryUtilization: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 100,
                        default: 80
                      },
                      customMetrics: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            targetValue: { type: 'string' },
                            selector: {
                              type: 'object',
                              properties: {
                                matchLabels: {
                                  type: 'object',
                                  additionalProperties: { type: 'string' }
                                }
                              }
                            }
                          },
                          required: ['name', 'targetValue']
                        }
                      }
                    }
                  },

                  // Service Configuration
                  services: {
                    type: 'object',
                    properties: {
                      gateway: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean', default: true },
                          replicas: { type: 'integer', minimum: 1, default: 2 },
                          image: { type: 'string' },
                          resources: {
                            type: 'object',
                            properties: {
                              requests: {
                                type: 'object',
                                properties: {
                                  cpu: { type: 'string', default: '100m' },
                                  memory: { type: 'string', default: '256Mi' }
                                }
                              },
                              limits: {
                                type: 'object',
                                properties: {
                                  cpu: { type: 'string', default: '500m' },
                                  memory: { type: 'string', default: '512Mi' }
                                }
                              }
                            }
                          }
                        }
                      },
                      api: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean', default: true },
                          replicas: { type: 'integer', minimum: 1, default: 2 },
                          image: { type: 'string' },
                          port: { type: 'integer', default: 3000 },
                          resources: {
                            type: 'object',
                            properties: {
                              requests: {
                                type: 'object',
                                properties: {
                                  cpu: { type: 'string', default: '100m' },
                                  memory: { type: 'string', default: '256Mi' }
                                }
                              },
                              limits: {
                                type: 'object',
                                properties: {
                                  cpu: { type: 'string', default: '500m' },
                                  memory: { type: 'string', default: '512Mi' }
                                }
                              }
                            }
                          }
                        }
                      },
                      audio: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean', default: true },
                          replicas: { type: 'integer', minimum: 1, default: 2 },
                          image: { type: 'string' },
                          lavalink: {
                            type: 'object',
                            properties: {
                              enabled: { type: 'boolean', default: true },
                              host: { type: 'string' },
                              port: { type: 'integer', default: 2333 },
                              password: { type: 'string' }
                            }
                          },
                          resources: {
                            type: 'object',
                            properties: {
                              requests: {
                                type: 'object',
                                properties: {
                                  cpu: { type: 'string', default: '200m' },
                                  memory: { type: 'string', default: '512Mi' }
                                }
                              },
                              limits: {
                                type: 'object',
                                properties: {
                                  cpu: { type: 'string', default: '1000m' },
                                  memory: { type: 'string', default: '1Gi' }
                                }
                              }
                            }
                          }
                        }
                      },
                      worker: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean', default: true },
                          replicas: { type: 'integer', minimum: 1, default: 1 },
                          image: { type: 'string' },
                          resources: {
                            type: 'object',
                            properties: {
                              requests: {
                                type: 'object',
                                properties: {
                                  cpu: { type: 'string', default: '50m' },
                                  memory: { type: 'string', default: '128Mi' }
                                }
                              },
                              limits: {
                                type: 'object',
                                properties: {
                                  cpu: { type: 'string', default: '200m' },
                                  memory: { type: 'string', default: '256Mi' }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  },

                  // Database Configuration
                  database: {
                    type: 'object',
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['postgresql', 'mysql'],
                        default: 'postgresql'
                      },
                      host: { type: 'string' },
                      port: { type: 'integer', default: 5432 },
                      name: { type: 'string', default: 'discord_bot' },
                      secretName: { type: 'string' },
                      ssl: { type: 'boolean', default: true },
                      poolSize: { type: 'integer', default: 10 }
                    },
                    required: ['host', 'secretName']
                  },

                  // Redis Configuration
                  redis: {
                    type: 'object',
                    properties: {
                      host: { type: 'string' },
                      port: { type: 'integer', default: 6379 },
                      secretName: { type: 'string' },
                      cluster: { type: 'boolean', default: false },
                      sentinel: { type: 'boolean', default: false }
                    },
                    required: ['host']
                  },

                  // Monitoring Configuration
                  monitoring: {
                    type: 'object',
                    properties: {
                      enabled: { type: 'boolean', default: true },
                      prometheus: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean', default: true },
                          scrapeInterval: { type: 'string', default: '30s' }
                        }
                      },
                      grafana: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean', default: true },
                          dashboards: { type: 'boolean', default: true }
                        }
                      },
                      alerts: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean', default: true },
                          slack: {
                            type: 'object',
                            properties: {
                              enabled: { type: 'boolean', default: false },
                              webhook: { type: 'string' }
                            }
                          }
                        }
                      }
                    }
                  },

                  // Security Configuration
                  security: {
                    type: 'object',
                    properties: {
                      podSecurityContext: {
                        type: 'object',
                        properties: {
                          runAsNonRoot: { type: 'boolean', default: true },
                          runAsUser: { type: 'integer', default: 1001 },
                          fsGroup: { type: 'integer', default: 1001 }
                        }
                      },
                      networkPolicies: {
                        type: 'object',
                        properties: {
                          enabled: { type: 'boolean', default: true },
                          ingress: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                from: {
                                  type: 'array',
                                  items: {
                                    type: 'object',
                                    properties: {
                                      namespaceSelector: {
                                        type: 'object',
                                        properties: {
                                          matchLabels: {
                                            type: 'object',
                                            additionalProperties: { type: 'string' }
                                          }
                                        }
                                      }
                                    }
                                  }
                                },
                                ports: {
                                  type: 'array',
                                  items: {
                                    type: 'object',
                                    properties: {
                                      protocol: { type: 'string', default: 'TCP' },
                                      port: { type: 'integer' }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                required: ['botToken', 'applicationId', 'database']
              },
              status: {
                type: 'object',
                properties: {
                  phase: {
                    type: 'string',
                    enum: ['Pending', 'Running', 'Failed', 'Succeeded'],
                    default: 'Pending'
                  },
                  conditions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        status: { type: 'string' },
                        lastTransitionTime: { type: 'string', format: 'date-time' },
                        reason: { type: 'string' },
                        message: { type: 'string' }
                      },
                      required: ['type', 'status']
                    }
                  },
                  services: {
                    type: 'object',
                    properties: {
                      gateway: {
                        type: 'object',
                        properties: {
                          ready: { type: 'boolean' },
                          replicas: { type: 'integer' },
                          readyReplicas: { type: 'integer' }
                        }
                      },
                      api: {
                        type: 'object',
                        properties: {
                          ready: { type: 'boolean' },
                          replicas: { type: 'integer' },
                          readyReplicas: { type: 'integer' }
                        }
                      },
                      audio: {
                        type: 'object',
                        properties: {
                          ready: { type: 'boolean' },
                          replicas: { type: 'integer' },
                          readyReplicas: { type: 'integer' }
                        }
                      },
                      worker: {
                        type: 'object',
                        properties: {
                          ready: { type: 'boolean' },
                          replicas: { type: 'integer' },
                          readyReplicas: { type: 'integer' }
                        }
                      }
                    }
                  },
                  observedGeneration: { type: 'integer' },
                  lastUpdateTime: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        },
        subresources: {
          status: {},
          scale: {
            specReplicasPath: '.spec.scaling.minReplicas',
            statusReplicasPath: '.status.services.gateway.replicas',
            labelSelectorPath: '.status.selector'
          }
        },
        additionalPrinterColumns: [
          {
            name: 'Phase',
            type: 'string',
            jsonPath: '.status.phase'
          },
          {
            name: 'Gateway Ready',
            type: 'string',
            jsonPath: '.status.services.gateway.ready'
          },
          {
            name: 'API Ready',
            type: 'string',
            jsonPath: '.status.services.api.ready'
          },
          {
            name: 'Audio Ready',
            type: 'string',
            jsonPath: '.status.services.audio.ready'
          },
          {
            name: 'Age',
            type: 'date',
            jsonPath: '.metadata.creationTimestamp'
          }
        ]
      }
    ],
    scope: 'Namespaced',
    names: {
      plural: 'discordbots',
      singular: 'discordbot',
      kind: 'DiscordBot',
      shortNames: ['db', 'dbot']
    }
  }
};