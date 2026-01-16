/**
 * Acontext Todo Tool
 * 
 * Exposes todo management as a tool that agent can call to create and manage
 * task lists for complex, multi-step tasks.
 */

export type TodoToolArgs = {
  /**
   * Action to perform: "create" to create a new todo list (automatically adds search skills task),
   * "add" to add a new task, "update" to update a task status/content, "list" to view all todos.
   */
  action: "create" | "add" | "update" | "list";
  
  /**
   * Task ID (required for update action)
   */
  taskId?: string;
  
  /**
   * Task content/description (required for add action, optional for update)
   */
  content?: string;
  
  /**
   * Task status: "pending", "in_progress", "completed", "failed"
   * (required for update action, optional for add)
   */
  status?: "pending" | "in_progress" | "completed" | "failed";
};

/**
 * Tool schema for the Todo management tool.
 * This allows the agent to create and manage task lists for complex tasks.
 */
export const getTodoToolSchema = {
  type: "function" as const,
  function: {
    name: "todo",
    description:
      "Create and manage a todo list for complex, multi-step tasks. Use this tool FIRST when you encounter a complex task (requiring 3+ distinct steps or involving multiple files/components). This helps break down the work into manageable steps and track progress. When you call 'create', it will automatically add a first task to search for relevant skills using experience_search. You can then add more tasks and update their status as you work through them.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "add", "update", "list"],
          description:
            "Action to perform: 'create' to initialize a new todo list (automatically adds a search skills task), 'add' to add a new task, 'update' to change task status/content, 'list' to view all todos.",
        },
        taskId: {
          type: "string",
          description:
            "Task ID (required for 'update' action). Use the ID returned from 'add' or 'list' actions.",
        },
        content: {
          type: "string",
          description:
            "Task description/content. Required for 'add' action, optional for 'update' action. Should be clear and actionable.",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "failed"],
          description:
            "Task status. Required for 'update' action. Use 'pending' for new tasks, 'in_progress' when working on it, 'completed' when done, 'failed' if the task encountered an error.",
        },
      },
      required: ["action"],
    },
  },
};

export type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type TodoListResult = {
  todos: TodoItem[];
  count: number;
  action: string;
  message?: string;
  taskId?: string;
};

// In-memory storage for todos (keyed by sessionId)
// TODO: Consider migrating to database for persistence across sessions
const todoStorage = new Map<string, TodoItem[]>();

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get todos for a session (or create empty list)
 */
function getTodosForSession(sessionId: string): TodoItem[] {
  if (!todoStorage.has(sessionId)) {
    todoStorage.set(sessionId, []);
  }
  return todoStorage.get(sessionId)!;
}

/**
 * Execute todo tool operations
 */
export async function runTodo(
  args: TodoToolArgs,
  sessionId: string
): Promise<TodoListResult> {
  const todos = getTodosForSession(sessionId);
  const now = new Date().toISOString();

  try {
    switch (args.action) {
      case "create": {
        // Clear existing todos and create a new list
        todos.length = 0;
        
        // Automatically add the first task: search for skills
        const searchTask: TodoItem = {
          id: "task_search_skills",
          content: "Search for relevant skills and experiences (using experience_search tool)",
          status: "pending",
          createdAt: now,
          updatedAt: now,
        };
        todos.push(searchTask);
        
        todoStorage.set(sessionId, todos);
        
        return {
          action: "create",
          todos: [...todos],
          count: todos.length,
          message: "Todo list created. First task (search skills) added automatically.",
        };
      }

      case "add": {
        if (!args.content || typeof args.content !== "string" || !args.content.trim()) {
          throw new Error("Content is required for 'add' action");
        }

        const newTask: TodoItem = {
          id: generateTaskId(),
          content: args.content.trim(),
          status: args.status || "pending",
          createdAt: now,
          updatedAt: now,
        };
        
        todos.push(newTask);
        todoStorage.set(sessionId, todos);
        
        return {
          action: "add",
          todos: [...todos],
          count: todos.length,
          taskId: newTask.id,
          message: "Task added successfully.",
        };
      }

      case "update": {
        if (!args.taskId) {
          throw new Error("Task ID is required for 'update' action");
        }

        const task = todos.find((t) => t.id === args.taskId);
        if (!task) {
          throw new Error(`Task with ID '${args.taskId}' not found`);
        }

        // Update status if provided
        if (args.status) {
          if (!["pending", "in_progress", "completed", "failed"].includes(args.status)) {
            throw new Error(`Invalid status: ${args.status}`);
          }
          task.status = args.status;
        }

        // Update content if provided
        if (args.content !== undefined) {
          if (typeof args.content !== "string" || !args.content.trim()) {
            throw new Error("Content must be a non-empty string");
          }
          task.content = args.content.trim();
        }

        task.updatedAt = now;
        todoStorage.set(sessionId, todos);
        
        return {
          action: "update",
          todos: [...todos],
          count: todos.length,
          taskId: task.id,
          message: `Task '${task.id}' updated successfully.`,
        };
      }

      case "list": {
        return {
          action: "list",
          todos: [...todos],
          count: todos.length,
          message: todos.length === 0 
            ? "No tasks found. Use 'create' action to initialize a todo list."
            : `Retrieved ${todos.length} task(s).`,
        };
      }

      default:
        throw new Error(`Unknown action: ${args.action}`);
    }
  } catch (error) {
    console.error("[Todo] Error executing todo action:", error);
    return {
      action: args.action,
      todos: [...todos],
      count: todos.length,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a tool name is the todo tool
 */
export function isTodoToolName(name: string): boolean {
  return name === "todo";
}

