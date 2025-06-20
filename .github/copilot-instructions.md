# Confluent VS Code Extension

This VS Code extension helps developers build stream processing applications using Confluent
technology. The extension integrates with Confluent Cloud products and Apache Kafka® compatible
clusters within VS Code.

## Core Principles

- **Type Safety**: Create TypeScript code with explicit types and no use of `any`
- **Clean Architecture**: Follow established patterns and directory organization
- **User Experience**: Design intuitive interfaces and write actionable error messages
- **Testing**: Unit test all code components with proper isolation
- **Performance**: Efficiently cache and load resources to ensure responsiveness

## Key Technologies

- TypeScript with strict type checking
- VS Code Extension API
- Confluent Cloud and Apache Kafka® ecosystem
- Sidecar architecture for multi-workspace management
- GraphQL and OpenAPI-generated clients

## Important Guidelines

- Never modify auto-generated code in `src/clients/` - update OpenAPI specs instead
