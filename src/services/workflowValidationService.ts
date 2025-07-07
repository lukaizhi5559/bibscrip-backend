/**
 * WorkflowValidationService
 * Phase 1: Foundation & Persistence Layer
 * Validates workflow data integrity and business rules
 */

import {
  OrchestrationWorkflow,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  TaskBreakdownStep,
  WorkflowAgent,
  WorkflowDependency,
  WorkflowRisk,
  WorkflowValidationError
} from '../types/orchestrationWorkflow';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class WorkflowValidationService {
  
  /**
   * Validate workflow creation request
   */
  validateCreateRequest(request: CreateWorkflowRequest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields validation
    if (!request.name || request.name.trim().length === 0) {
      errors.push('Workflow name is required');
    }

    if (request.name && request.name.length > 255) {
      errors.push('Workflow name must be 255 characters or less');
    }

    if (!request.task_breakdown || request.task_breakdown.length === 0) {
      errors.push('Task breakdown is required and must contain at least one step');
    }

    if (!request.agents || request.agents.length === 0) {
      errors.push('Agents array is required and must contain at least one agent');
    }

    // Validate task breakdown
    if (request.task_breakdown) {
      const taskValidation = this.validateTaskBreakdown(request.task_breakdown);
      errors.push(...taskValidation.errors);
      warnings.push(...taskValidation.warnings);
    }

    // Validate agents
    if (request.agents) {
      const agentValidation = this.validateAgents(request.agents);
      errors.push(...agentValidation.errors);
      warnings.push(...agentValidation.warnings);
    }

    // Validate dependencies
    if (request.dependencies) {
      const depValidation = this.validateDependencies(request.dependencies);
      errors.push(...depValidation.errors);
      warnings.push(...depValidation.warnings);
    }

    // Validate risks
    if (request.risks) {
      const riskValidation = this.validateRisks(request.risks);
      errors.push(...riskValidation.errors);
      warnings.push(...riskValidation.warnings);
    }

    // Validate success rate
    if (request.estimated_success_rate !== undefined) {
      if (request.estimated_success_rate < 0 || request.estimated_success_rate > 1) {
        errors.push('Estimated success rate must be between 0 and 1');
      }
    }

    // Cross-validation: agents vs task breakdown
    if (request.task_breakdown && request.agents) {
      const crossValidation = this.validateAgentTaskAlignment(request.task_breakdown, request.agents);
      errors.push(...crossValidation.errors);
      warnings.push(...crossValidation.warnings);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate workflow update request
   */
  validateUpdateRequest(request: UpdateWorkflowRequest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Name validation (if provided)
    if (request.name !== undefined) {
      if (!request.name || request.name.trim().length === 0) {
        errors.push('Workflow name cannot be empty');
      }
      if (request.name && request.name.length > 255) {
        errors.push('Workflow name must be 255 characters or less');
      }
    }

    // Status validation (if provided)
    if (request.status !== undefined) {
      const validStatuses = ['draft', 'running', 'paused', 'completed', 'failed'];
      if (!validStatuses.includes(request.status)) {
        errors.push(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }
    }

    // Task breakdown validation (if provided)
    if (request.task_breakdown !== undefined) {
      if (request.task_breakdown.length === 0) {
        errors.push('Task breakdown must contain at least one step');
      } else {
        const taskValidation = this.validateTaskBreakdown(request.task_breakdown);
        errors.push(...taskValidation.errors);
        warnings.push(...taskValidation.warnings);
      }
    }

    // Agents validation (if provided)
    if (request.agents !== undefined) {
      if (request.agents.length === 0) {
        errors.push('Agents array must contain at least one agent');
      } else {
        const agentValidation = this.validateAgents(request.agents);
        errors.push(...agentValidation.errors);
        warnings.push(...agentValidation.warnings);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate complete workflow
   */
  validateWorkflow(workflow: OrchestrationWorkflow): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic field validation
    if (!workflow.name || workflow.name.trim().length === 0) {
      errors.push('Workflow name is required');
    }

    if (!workflow.task_breakdown || workflow.task_breakdown.length === 0) {
      errors.push('Task breakdown is required');
    }

    if (!workflow.agents || workflow.agents.length === 0) {
      errors.push('Agents array is required');
    }

    // Execution state validation
    if (workflow.current_step < 0) {
      errors.push('Current step cannot be negative');
    }

    if (workflow.task_breakdown && workflow.current_step >= workflow.task_breakdown.length) {
      warnings.push('Current step is beyond the last task breakdown step');
    }

    // Status-specific validation
    if (workflow.status === 'running' && workflow.current_step === 0) {
      warnings.push('Workflow is marked as running but has not progressed past step 0');
    }

    if (workflow.status === 'completed' && workflow.current_step < workflow.task_breakdown.length - 1) {
      warnings.push('Workflow is marked as completed but current step suggests it is not finished');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate task breakdown steps
   */
  private validateTaskBreakdown(steps: TaskBreakdownStep[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const stepNumbers = new Set<number>();

    steps.forEach((step, index) => {
      // Step number validation
      if (step.step === undefined || step.step === null) {
        errors.push(`Step ${index + 1}: Step number is required`);
      } else {
        if (stepNumbers.has(step.step)) {
          errors.push(`Step ${index + 1}: Duplicate step number ${step.step}`);
        }
        stepNumbers.add(step.step);

        if (step.step < 1) {
          errors.push(`Step ${index + 1}: Step number must be positive`);
        }
      }

      // Description validation
      if (!step.description || step.description.trim().length === 0) {
        errors.push(`Step ${step.step || index + 1}: Description is required`);
      }

      // Agent needed validation
      if (!step.agent_needed || step.agent_needed.trim().length === 0) {
        errors.push(`Step ${step.step || index + 1}: Agent needed is required`);
      }

      // Inputs/outputs validation
      if (!step.inputs || step.inputs.length === 0) {
        warnings.push(`Step ${step.step || index + 1}: No inputs specified`);
      }

      if (!step.outputs || step.outputs.length === 0) {
        warnings.push(`Step ${step.step || index + 1}: No outputs specified`);
      }

      // Dependencies validation
      if (step.dependencies) {
        step.dependencies.forEach(dep => {
          if (!steps.some(s => s.agent_needed === dep)) {
            warnings.push(`Step ${step.step || index + 1}: Dependency "${dep}" not found in agents list`);
          }
        });
      }
    });

    // Check for sequential step numbering
    const sortedSteps = Array.from(stepNumbers).sort((a, b) => a - b);
    for (let i = 0; i < sortedSteps.length - 1; i++) {
      if (sortedSteps[i + 1] - sortedSteps[i] > 1) {
        warnings.push(`Gap in step numbering between ${sortedSteps[i]} and ${sortedSteps[i + 1]}`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate workflow agents
   */
  private validateAgents(agents: WorkflowAgent[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const agentNames = new Set<string>();
    const executionOrders = new Set<number>();

    agents.forEach((agent, index) => {
      // Name validation
      if (!agent.name || agent.name.trim().length === 0) {
        errors.push(`Agent ${index + 1}: Name is required`);
      } else {
        if (agentNames.has(agent.name)) {
          errors.push(`Agent ${index + 1}: Duplicate agent name "${agent.name}"`);
        }
        agentNames.add(agent.name);
      }

      // Type validation
      if (!agent.type || agent.type.trim().length === 0) {
        errors.push(`Agent ${agent.name || index + 1}: Type is required`);
      }

      // Reason validation
      if (!agent.reason || agent.reason.trim().length === 0) {
        warnings.push(`Agent ${agent.name || index + 1}: Reason is not provided`);
      }

      // Execution order validation
      if (agent.execution_order === undefined || agent.execution_order === null) {
        errors.push(`Agent ${agent.name || index + 1}: Execution order is required`);
      } else {
        if (executionOrders.has(agent.execution_order)) {
          errors.push(`Agent ${agent.name || index + 1}: Duplicate execution order ${agent.execution_order}`);
        }
        executionOrders.add(agent.execution_order);

        if (agent.execution_order < 1) {
          errors.push(`Agent ${agent.name || index + 1}: Execution order must be positive`);
        }
      }
    });

    // Check for sequential execution order
    const sortedOrders = Array.from(executionOrders).sort((a, b) => a - b);
    for (let i = 0; i < sortedOrders.length - 1; i++) {
      if (sortedOrders[i + 1] - sortedOrders[i] > 1) {
        warnings.push(`Gap in execution order between ${sortedOrders[i]} and ${sortedOrders[i + 1]}`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate workflow dependencies
   */
  private validateDependencies(dependencies: WorkflowDependency[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    dependencies.forEach((dep, index) => {
      if (!dep.type || dep.type.trim().length === 0) {
        errors.push(`Dependency ${index + 1}: Type is required`);
      }

      if (!dep.description || dep.description.trim().length === 0) {
        errors.push(`Dependency ${index + 1}: Description is required`);
      }

      const validTypes = ['oauth', 'api_key', 'system_access', 'permission', 'service'];
      if (dep.type && !validTypes.includes(dep.type)) {
        errors.push(`Dependency ${index + 1}: Invalid type. Must be one of: ${validTypes.join(', ')}`);
      }

      if (dep.required === undefined) {
        warnings.push(`Dependency ${index + 1}: Required flag not specified, defaulting to true`);
      }
    });

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate workflow risks
   */
  private validateRisks(risks: WorkflowRisk[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    risks.forEach((risk, index) => {
      if (!risk.risk || risk.risk.trim().length === 0) {
        errors.push(`Risk ${index + 1}: Risk description is required`);
      }

      if (!risk.mitigation || risk.mitigation.trim().length === 0) {
        errors.push(`Risk ${index + 1}: Mitigation strategy is required`);
      }

      const validSeverities = ['low', 'medium', 'high'];
      if (!risk.severity || !validSeverities.includes(risk.severity)) {
        errors.push(`Risk ${index + 1}: Invalid severity. Must be one of: ${validSeverities.join(', ')}`);
      }

      if (risk.probability !== undefined) {
        if (risk.probability < 0 || risk.probability > 1) {
          errors.push(`Risk ${index + 1}: Probability must be between 0 and 1`);
        }
      }
    });

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate alignment between agents and task breakdown
   */
  private validateAgentTaskAlignment(
    tasks: TaskBreakdownStep[],
    agents: WorkflowAgent[]
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const agentNames = new Set(agents.map(a => a.name));
    const requiredAgents = new Set(tasks.map(t => t.agent_needed));

    // Check if all required agents exist
    requiredAgents.forEach(requiredAgent => {
      if (!agentNames.has(requiredAgent)) {
        errors.push(`Task breakdown requires agent "${requiredAgent}" but it's not defined in agents array`);
      }
    });

    // Check for unused agents
    agentNames.forEach(agentName => {
      if (!requiredAgents.has(agentName)) {
        warnings.push(`Agent "${agentName}" is defined but not used in task breakdown`);
      }
    });

    // Validate execution order matches task sequence
    const taskAgentOrder = tasks
      .sort((a, b) => a.step - b.step)
      .map(t => t.agent_needed);
    
    const agentExecutionOrder = agents
      .sort((a, b) => a.execution_order - b.execution_order)
      .map(a => a.name);

    // Check if execution order aligns with task sequence
    for (let i = 0; i < Math.min(taskAgentOrder.length, agentExecutionOrder.length); i++) {
      if (taskAgentOrder[i] !== agentExecutionOrder[i]) {
        warnings.push(
          `Execution order mismatch: Task step ${i + 1} requires "${taskAgentOrder[i]}" ` +
          `but agent execution order ${i + 1} is "${agentExecutionOrder[i]}"`
        );
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate workflow for execution readiness
   */
  validateExecutionReadiness(workflow: OrchestrationWorkflow): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check workflow status
    if (workflow.status === 'running') {
      errors.push('Workflow is already running');
    }

    if (workflow.status === 'completed') {
      warnings.push('Workflow is already completed');
    }

    // Check dependencies
    const unsatisfiedDeps = workflow.dependencies.filter(dep => 
      dep.required && dep.status !== 'satisfied'
    );

    if (unsatisfiedDeps.length > 0) {
      errors.push(`Unsatisfied dependencies: ${unsatisfiedDeps.map(d => d.description).join(', ')}`);
    }

    // Check high-risk operations
    const highRisks = workflow.risks.filter(risk => risk.severity === 'high');
    if (highRisks.length > 0) {
      warnings.push(`High-risk operations detected: ${highRisks.map(r => r.risk).join(', ')}`);
    }

    return { isValid: errors.length === 0, errors, warnings };
  }
}
