import { HttpClient, Api } from 'tonapi-sdk-js';
import chalk from 'chalk';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Wrapper class for working with tonapi-sdk-js
 */
export class TonApiCliWrapper {
  private client: Api<unknown>;
  private network: string;
  private moduleFilter: string[];

  /**
   * Creates an instance of the wrapper for tonapi-sdk-js
   * @param options Initialization options
   */
  constructor(options: { 
    testnet?: boolean; 
    apiKey?: string; 
    skipApiKeyCheck?: boolean;
    moduleFilter?: string[];
  } = {}) {
    // Determine the network to use
    const isTestnet = options.testnet === true;
    this.network = isTestnet ? 'testnet' : 'mainnet';
    
    // Более подробное логирование параметра testnet
    console.error(chalk.cyan(`TonApiCliWrapper constructor: testnet parameter: ${options.testnet} (${typeof options.testnet})`));
    console.error(chalk.cyan(`TonApiCliWrapper constructor: isTestnet value: ${isTestnet} (${typeof isTestnet})`));
    
    // Base API URL depending on the network
    const baseUrl = isTestnet ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
    console.error(chalk.blue(`Using ${this.network} network: ${baseUrl}`));
    
    // Get API key from options or environment variables
    const apiKey = options.apiKey || process.env.TON_API_KEY;
    
    // Check for API key only if check is not skipped
    if (!apiKey && !options.skipApiKeyCheck) {
      console.error(chalk.red('Error: API key not specified. Provide it using the --api-key option or set the TON_API_KEY environment variable'));
      throw new Error('API key is required');
    }
    
    // Define request headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    // Add authorization header only if API key is provided
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    // Create HTTP client with settings
    const httpClient = new HttpClient({
      baseUrl,
      baseApiParams: {
        headers
      }
    });
    
    // Initialize API client
    this.client = new Api(httpClient);
    
    // Store module filter if provided
    this.moduleFilter = options.moduleFilter || [];
    if (this.moduleFilter.length > 0) {
      console.error(chalk.blue(`Module filter applied: ${this.moduleFilter.join(', ')}`));
    }
  }

  /**
   * Gets all available API modules
   */
  getApiModules(): string[] {
    // Get all keys (modules) from API client, excluding service properties and methods
    let modules = Object.keys(this.client)
      .filter(key => 
        typeof (this.client as any)[key] === 'object' && 
        key !== 'http' && 
        !key.startsWith('_')
      );
    
    // Apply module filter if set
    if (this.moduleFilter && this.moduleFilter.length > 0) {
      modules = modules.filter(module => 
        this.moduleFilter.includes(module.toLowerCase())
      );
    }
    
    return modules;
  }

  /**
   * Gets all methods of the specified API module
   * @param moduleName API module name
   */
  getModuleMethods(moduleName: string): string[] {
    if (!this.hasModule(moduleName)) {
      return [];
    }
    
    // Get all methods of the module
    const module = (this.client as any)[moduleName];
    return Object.keys(module)
      .filter(key => typeof module[key] === 'function');
  }

  /**
   * Checks if the specified module exists in the API
   * @param moduleName Module name
   */
  hasModule(moduleName: string): boolean {
    return this.getApiModules().includes(moduleName);
  }

  /**
   * Checks if the specified method exists in the API module
   * @param moduleName Module name
   * @param methodName Method name
   */
  hasMethod(moduleName: string, methodName: string): boolean {
    return this.hasModule(moduleName) && 
           this.getModuleMethods(moduleName).includes(methodName);
  }

  /**
   * Calls an API method with the specified arguments
   * @param moduleName API module name
   * @param methodName API method name
   * @param args Arguments for the method call
   */
  async callMethod(moduleName: string, methodName: string, ...args: any[]): Promise<any> {
    if (!this.hasMethod(moduleName, methodName)) {
      throw new Error(`Method ${methodName} not found in module ${moduleName}`);
    }
    
    try {
      // Get reference to the module and method
      const module = (this.client as any)[moduleName];
      const method = module[methodName];
      
      // Call the method with provided arguments
      return await method.apply(module, args);
    } catch (error: any) {
      console.error(chalk.red(`Error calling ${moduleName}.${methodName}: ${error.message}`));
      throw error;
    }
  }

  /**
   * Gets the API client instance
   */
  getApiClient(): Api<unknown> {
    return this.client;
  }
  
  /**
   * Gets information about the current network
   */
  getNetwork(): string {
    return this.network;
  }

  /**
   * Gets description of an API method from JSDoc comments
   * @param moduleName API module name
   * @param methodName API method name
   * @returns Description of the method or empty string if not found
   */
  getMethodDescription(moduleName: string, methodName: string): string {
    if (!this.hasMethod(moduleName, methodName)) {
      return '';
    }
    
    try {
      // In the generated SDK, descriptions are not directly accessible in runtime
      // We return a generic description based on the method and module name
      return `Method ${methodName} from ${moduleName} module`;
    } catch (error) {
      return '';
    }
  }

  /**
   * Gets parameter signature of an API method
   * @param moduleName API module name
   * @param methodName API method name
   * @returns Parameter signature of the method or empty string if not found
   */
  getMethodSignature(moduleName: string, methodName: string): string {
    if (!this.hasMethod(moduleName, methodName)) {
      return '';
    }
    
    try {
      // Analyze the method in runtime
      const moduleObj = (this.client as any)[moduleName];
      const methodObj = moduleObj[methodName];
      
      // Get the parameters object from first line of the function
      const methodStr = methodObj.toString();
      const paramMatch = /\(([^)]*)\)\s*=>/.exec(methodStr);
      
      if (paramMatch && paramMatch[1]) {
        const paramStr = paramMatch[1].trim();
        
        if (paramStr === '') {
          return 'No parameters required';
        } else if (paramStr === 'params = {}') {
          return 'Optional RequestParams object';
        } else {
          return paramStr;
        }
      }
      
      return 'Parameter structure unavailable';
    } catch (error) {
      return '';
    }
  }

  /**
   * Parses arguments from CLI options
   * @param options Options object containing params and args
   * @returns Array of parsed arguments
   */
  parseArguments(options: { params?: string; args?: string[] }): any[] {
    let args: any[] = [];
    
    // Process parameters
    if (options.params) {
      try {
        const params = JSON.parse(options.params);
        args.push(params);
      } catch (error) {
        console.error(chalk.red(`Error parsing JSON parameters: ${error}`));
        throw new Error(`Error parsing JSON parameters: ${error}`);
      }
    }
    
    // Add positional arguments if they exist
    if (options.args && options.args.length > 0) {
      // Try to convert string arguments to appropriate types (numbers, booleans, etc.)
      const parsedArgs = options.args.map((arg: string) => {
        // Try to parse JSON
        try {
          return JSON.parse(arg);
        } catch {
          // If parsing fails - leave as string
          return arg;
        }
      });
      
      args = args.concat(parsedArgs);
    }
    
    return args;
  }

  /**
   * Gets sorted list of all modules and methods
   * @returns Object with sorted modules and their methods
   */
  getSortedModulesAndMethods(): { modules: string[]; methodsByModule: Record<string, string[]> } {
    const modules = this.getApiModules();
    const sortedModules = [...modules].sort();
    
    const methodsByModule: Record<string, string[]> = {};
    
    sortedModules.forEach(moduleName => {
      const methods = this.getModuleMethods(moduleName);
      methodsByModule[moduleName] = [...methods].sort();
    });
    
    return {
      modules: sortedModules,
      methodsByModule
    };
  }
} 