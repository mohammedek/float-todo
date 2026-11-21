#!/usr/bin/env node
/**
 * Float Todo MCP Server
 * Exposes Float Todo tasks as MCP tools and resources.
 * Reads/writes ~/Library/Application Support/floating-todo/todos.json
 *
 * Usage: node mcp-server.js
 * Connect via Claude Desktop or any MCP client (stdio transport).
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = process.env.FLOAT_TODO_PATH ||
  path.join(process.env.HOME, 'Library', 'Application Support', 'floating-todo', 'todos.json');

function loadTodos() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveTodos(todos) {
  const tmp = DATA_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(todos, null, 2));
  fs.renameSync(tmp, DATA_PATH);
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const TOOLS = [
  {
    name: 'list_tasks',
    description: 'List all tasks. Returns pending and completed tasks.',
    inputSchema: { type: 'object', properties: { include_done: { type: 'boolean', description: 'Include completed tasks (default: true)' } } }
  },
  {
    name: 'add_task',
    description: 'Add a new task.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Task description' }, project: { type: 'string', description: 'Optional project name' }, pet: { type: 'string', description: 'Optional cat pet name' } }, required: ['text'] }
  },
  {
    name: 'complete_task',
    description: 'Mark a task as complete by ID or partial text match.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' } } }
  },
  {
    name: 'uncomplete_task',
    description: 'Mark a task as incomplete (reopen).',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' } } }
  },
  {
    name: 'delete_task',
    description: 'Delete a task by ID or partial text match.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' } } }
  },
  {
    name: 'edit_task',
    description: 'Edit a task title.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' }, new_text: { type: 'string' } }, required: ['new_text'] }
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a task.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' }, comment: { type: 'string' } }, required: ['comment'] }
  },
  {
    name: 'assign_project',
    description: 'Assign a project to a task.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' }, project: { type: 'string' } }, required: ['project'] }
  },
  {
    name: 'assign_pet',
    description: 'Assign a cat pet to a task.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' }, pet: { type: 'string' } }, required: ['pet'] }
  },
  {
    name: 'clear_completed',
    description: 'Remove all completed tasks.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function findTask(todos, args) {
  if (args.id) return todos.find(t => t.id === args.id);
  if (args.text) {
    const lower = args.text.toLowerCase();
    return todos.find(t => t.text.toLowerCase().includes(lower));
  }
  return null;
}

function handleTool(name, args) {
  const todos = loadTodos();
  switch (name) {
    case 'list_tasks': {
      const includeDone = args.include_done !== false;
      const filtered = includeDone ? todos : todos.filter(t => !t.done);
      return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
    }
    case 'add_task': {
      const task = {
        id: Date.now(),
        text: args.text,
        done: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
        project: args.project || null,
        pet: args.pet || null
      };
      todos.unshift(task);
      saveTodos(todos);
      return { content: [{ type: 'text', text: `Added task: "${args.text}" (id: ${task.id})` }] };
    }
    case 'complete_task': {
      const t = findTask(todos, args);
      if (!t) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
      t.done = true;
      t.updatedAt = new Date().toISOString();
      saveTodos(todos);
      return { content: [{ type: 'text', text: `Completed: "${t.text}"` }] };
    }
    case 'uncomplete_task': {
      const t = findTask(todos, args);
      if (!t) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
      t.done = false;
      t.updatedAt = new Date().toISOString();
      saveTodos(todos);
      return { content: [{ type: 'text', text: `Reopened: "${t.text}"` }] };
    }
    case 'delete_task': {
      const t = findTask(todos, args);
      if (!t) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
      const idx = todos.indexOf(t);
      todos.splice(idx, 1);
      saveTodos(todos);
      return { content: [{ type: 'text', text: `Deleted: "${t.text}"` }] };
    }
    case 'edit_task': {
      const t = findTask(todos, args);
      if (!t) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
      t.text = args.new_text;
      t.updatedAt = new Date().toISOString();
      saveTodos(todos);
      return { content: [{ type: 'text', text: `Updated: "${t.text}"` }] };
    }
    case 'add_comment': {
      const t = findTask(todos, args);
      if (!t) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
      if (!t.comments) t.comments = [];
      t.comments.push({ text: args.comment, createdAt: new Date().toISOString() });
      t.updatedAt = new Date().toISOString();
      saveTodos(todos);
      return { content: [{ type: 'text', text: `Comment added to "${t.text}"` }] };
    }
    case 'assign_project': {
      const t = findTask(todos, args);
      if (!t) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
      t.project = args.project;
      t.updatedAt = new Date().toISOString();
      saveTodos(todos);
      return { content: [{ type: 'text', text: `Project "${args.project}" assigned to "${t.text}"` }] };
    }
    case 'assign_pet': {
      const t = findTask(todos, args);
      if (!t) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
      t.pet = args.pet;
      t.updatedAt = new Date().toISOString();
      saveTodos(todos);
      return { content: [{ type: 'text', text: `Pet "${args.pet}" assigned to "${t.text}"` }] };
    }
    case 'clear_completed': {
      const before = todos.length;
      const remaining = todos.filter(t => !t.done);
      saveTodos(remaining);
      return { content: [{ type: 'text', text: `Cleared ${before - remaining.length} completed tasks. ${remaining.length} remaining.` }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

// Read stdin (JSON-RPC)
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      const { id, method, params } = req;
      switch (method) {
        case 'initialize':
          respond(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'float-todo', version: '1.0.0' }
          });
          break;
        case 'tools/list':
          respond(id, { tools: TOOLS });
          break;
        case 'tools/call':
          respond(id, handleTool(params.name, params.arguments || {}));
          break;
        case 'resources/list':
          respond(id, {
            resources: [
              { uri: 'float-todo://tasks/pending', name: 'Pending Tasks', mimeType: 'application/json' },
              { uri: 'float-todo://tasks/all', name: 'All Tasks', mimeType: 'application/json' }
            ]
          });
          break;
        case 'resources/read': {
          const todos = loadTodos();
          const uri = params.uri;
          let data;
          if (uri === 'float-todo://tasks/pending') data = todos.filter(t => !t.done);
          else if (uri === 'float-todo://tasks/all') data = todos;
          else { error(id, -32602, 'Unknown resource'); break; }
          respond(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] });
          break;
        }
        case 'notifications/initialized':
          // no-op
          break;
        default:
          if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      // ignore parse errors
    }
  }
});

process.stdin.on('end', () => process.exit(0));
