import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import logger from '../logging/logger';
import { sanitizeErrorMessage, sanitizeConfig } from '../errors/sanitize';
import { loadEnvironment } from './environment';

// Load environment configuration
loadEnvironment();

/**
 * Configuration interface
 */
export interface Config {
  /**
   * Node connection configuration
   */
  node: {
    /**
     * Type of connection to use
     */
    connectionType: 'lnd-direct' | 'lnc' | 'mock';

    /**
     * LND direct connection configuration
     */
    lnd: {
      /** Path to the TLS certificate file */
      tlsCertPath: string;
      /** Path to the macaroon file for authentication */
      macaroonPath: string;
      /** LND host address */
      host: string;
      /** LND port number */
      port: string;
    };

    /**
     * Lightning Node Connect configuration
     */
    lnc?: {
      /** LNC connection string */
      connectionString: string;
      /** Optional pairing phrase */
      pairingPhrase?: string;
    };
  };

  /**
   * Server configuration
   */
  server: {
    /** Server port number */
    port: number;
    /** Application logging level */
    logLevel: string;
    /** Current environment (development, test, production) */
    environment: string;
  };
}

/**
 * Sets up mock LND environment if mock mode is enabled
 * Creates necessary certificate and macaroon files for testing
 */
function setupMockLndIfNeeded(): void {
  if (process.env.USE_MOCK_LND === 'true') {
    // Define paths for mock files
    const mockDir = path.resolve(process.cwd(), 'mock');
    const mockCertPath = path.resolve(mockDir, 'mock-cert.pem');
    const mockMacaroonPath = path.resolve(mockDir, 'mock-macaroon');

    // Create mock directory if it doesn't exist
    if (!existsSync(mockDir)) {
      mkdirSync(mockDir, { recursive: true });
    }

    // Create mock certificate if it doesn't exist
    if (!existsSync(mockCertPath)) {
      writeFileSync(mockCertPath, 'MOCK TLS CERTIFICATE');
      logger.debug(`Created mock TLS certificate at ${mockCertPath}`);
    }

    // Create mock macaroon if it doesn't exist
    if (!existsSync(mockMacaroonPath)) {
      writeFileSync(mockMacaroonPath, 'MOCK MACAROON');
      logger.debug(`Created mock macaroon at ${mockMacaroonPath}`);
    }

    // Set environment variables to use mock files
    process.env.LND_TLS_CERT_PATH = mockCertPath;
    process.env.LND_MACAROON_PATH = mockMacaroonPath;

    logger.info('Using mock LND mode with generated certificate and macaroon');
  }
}

/**
 * Validate required configuration values
 */
function validateConfig(): void {
  // When not in mock mode and using direct LND connection, check if required files exist
  if (process.env.USE_MOCK_LND !== 'true' && process.env.CONNECTION_TYPE === 'lnd-direct') {
    const tlsCertPath = process.env.LND_TLS_CERT_PATH;
    const macaroonPath = process.env.LND_MACAROON_PATH;

    if (!tlsCertPath || !macaroonPath) {
      throw new Error('Missing required LND configuration (tlsCertPath or macaroonPath)');
    }

    if (!existsSync(tlsCertPath)) {
      throw new Error(`TLS certificate file not found at: ${tlsCertPath}`);
    }

    if (!existsSync(macaroonPath)) {
      throw new Error(`Macaroon file not found at: ${macaroonPath}`);
    }
  }

  // Validate LNC configuration if using LNC
  if (process.env.CONNECTION_TYPE === 'lnc') {
    if (!process.env.LNC_CONNECTION_STRING) {
      throw new Error('Missing required LNC configuration (connectionString)');
    }
  }

  // Validate port numbers
  const port = parseInt(process.env.PORT || '', 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid server port: ${process.env.PORT}`);
  }

  if (process.env.LND_PORT) {
    const lndPort = parseInt(process.env.LND_PORT, 10);
    if (isNaN(lndPort) || lndPort <= 0 || lndPort > 65535) {
      throw new Error(`Invalid LND port: ${process.env.LND_PORT}`);
    }
  }
}

/**
 * Get configuration
 */
export function getConfig(): Config {
  try {
    // Setup mock LND environment if needed
    setupMockLndIfNeeded();

    // Validate configuration
    validateConfig();

    // Determine connection type from environment or default to lnd-direct
    const connectionType =
      (process.env.CONNECTION_TYPE as 'lnd-direct' | 'lnc' | 'mock') ||
      (process.env.USE_MOCK_LND === 'true' ? 'mock' : 'lnd-direct');

    // Create configuration object
    const config: Config = {
      node: {
        connectionType,
        lnd: {
          tlsCertPath: process.env.LND_TLS_CERT_PATH as string,
          macaroonPath: process.env.LND_MACAROON_PATH as string,
          host: process.env.LND_HOST || 'localhost',
          port: process.env.LND_PORT || '10009',
        },
      },

      server: {
        port: parseInt(process.env.PORT || '3000', 10),
        logLevel: process.env.LOG_LEVEL || 'info',
        environment: process.env.NODE_ENV || 'development',
      },
    };

    // Add LNC config if needed
    if (connectionType === 'lnc') {
      config.node.lnc = {
        connectionString: process.env.LNC_CONNECTION_STRING as string,
        pairingPhrase: process.env.LNC_PAIRING_PHRASE,
      };
    }

    // Log sanitized configuration
    logger.info(`Configuration loaded successfully: ${JSON.stringify(sanitizeConfig(config))}`);
    return config;
  } catch (error) {
    // Create a sanitized error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const sanitizedMessage = sanitizeErrorMessage(errorMessage);

    // Log the sanitized message
    logger.error(`Failed to load configuration: ${sanitizedMessage}`);

    // Create a new error with the sanitized message to avoid exposing sensitive information
    const sanitizedError = new Error(sanitizedMessage);
    if (error instanceof Error && error.stack) {
      sanitizedError.stack = error.stack;
    }

    // Throw the sanitized error
    throw sanitizedError;
  }
}
