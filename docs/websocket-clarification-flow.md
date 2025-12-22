# WebSocket Clarification Flow for Computer Use API

## Overview

The Computer Use API supports **clarification questions** through WebSocket for bidirectional communication. This allows the AI to ask the user for more information when needed during the agentic loop.

---

## Message Types

### Client → Server

```typescript
// 1. Start task
{
  type: 'start',
  goal: 'Open Thinkdrop AI project',
  context: { activeApp: 'Google Chrome' },
  maxIterations: 20,
  provider: 'anthropic'
}

// 2. Send screenshot
{
  type: 'screenshot',
  screenshot: {
    base64: 'iVBORw0KGgo...',
    mimeType: 'image/png'
  }
}

// 3. Answer clarification questions
{
  type: 'clarification_answer',
  answers: {
    'target_app': 'Google Chrome',
    'project_name': 'Thinkdrop AI'
  }
}

// 4. Cancel task
{
  type: 'cancel'
}
```

### Server → Client

```typescript
// 1. Action to execute
{
  type: 'action',
  action: {
    type: 'findAndClick',
    locator: { strategy: 'vision', description: '...' },
    reasoning: '...'
  },
  iteration: 1
}

// 2. Clarification needed
{
  type: 'clarification',
  questions: [
    {
      id: 'target_app',
      question: 'Which application should I work with?',
      options: ['Google Chrome', 'Safari', 'Firefox'],
      required: true
    }
  ]
}

// 3. Status update
{
  type: 'status',
  message: 'Connected to Computer Use API'
}

// 4. Task complete
{
  type: 'complete',
  result: {
    success: true,
    reason: 'Goal achieved',
    iterations: 5
  }
}

// 5. Error
{
  type: 'error',
  error: 'Failed to analyze screenshot'
}
```

---

## Flow Diagram

```
┌─────────────┐                                    ┌─────────────┐
│   Frontend  │                                    │   Backend   │
└──────┬──────┘                                    └──────┬──────┘
       │                                                  │
       │  1. WebSocket Connect                           │
       ├─────────────────────────────────────────────────>│
       │                                                  │
       │  2. { type: 'start', goal: '...' }              │
       ├─────────────────────────────────────────────────>│
       │                                                  │
       │  3. Check if clarification needed               │
       │                                                  ├─┐
       │                                                  │ │ Analyze goal
       │                                                  │<┘
       │                                                  │
       │  4. { type: 'clarification', questions: [...] } │
       │<─────────────────────────────────────────────────┤
       │                                                  │
       ├─┐                                                │
       │ │ Show UI prompt                                │
       │ │ User answers                                  │
       │<┘                                                │
       │                                                  │
       │  5. { type: 'clarification_answer', answers }   │
       ├─────────────────────────────────────────────────>│
       │                                                  │
       │  6. { type: 'action', action: screenshot }      │
       │<─────────────────────────────────────────────────┤
       │                                                  │
       ├─┐                                                │
       │ │ Capture screenshot                            │
       │<┘                                                │
       │                                                  │
       │  7. { type: 'screenshot', screenshot: {...} }   │
       ├─────────────────────────────────────────────────>│
       │                                                  │
       │  8. Analyze with vision LLM                     │
       │                                                  ├─┐
       │                                                  │ │ Claude/GPT-4V
       │                                                  │<┘
       │                                                  │
       │  9. { type: 'action', action: findAndClick }    │
       │<─────────────────────────────────────────────────┤
       │                                                  │
       ├─┐                                                │
       │ │ Execute action                                │
       │ │ Capture screenshot                            │
       │<┘                                                │
       │                                                  │
       │  10. { type: 'screenshot', screenshot: {...} }  │
       ├─────────────────────────────────────────────────>│
       │                                                  │
       │  ... loop continues ...                         │
       │                                                  │
       │  11. { type: 'complete', result: {...} }        │
       │<─────────────────────────────────────────────────┤
       │                                                  │
       │  12. WebSocket Close                            │
       ├─────────────────────────────────────────────────>│
       │                                                  │
```

---

## Frontend Implementation Example

```typescript
class ComputerUseClient {
  private ws: WebSocket | null = null;
  private currentIteration = 0;
  private previousActions: any[] = [];

  async executeTask(goal: string, context: any) {
    return new Promise((resolve, reject) => {
      // Connect to WebSocket
      this.ws = new WebSocket('ws://localhost:3000/api/computer-use/ws');

      this.ws.onopen = () => {
        console.log('Connected to Computer Use API');
        
        // Start task
        this.ws!.send(JSON.stringify({
          type: 'start',
          goal,
          context,
          maxIterations: 20,
          provider: 'anthropic'
        }));
      };

      this.ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'action':
            await this.handleAction(message.action);
            break;

          case 'clarification':
            await this.handleClarification(message.questions);
            break;

          case 'status':
            console.log('Status:', message.message);
            break;

          case 'complete':
            console.log('Task complete:', message.result);
            this.ws!.close();
            resolve(message.result);
            break;

          case 'error':
            console.error('Error:', message.error);
            this.ws!.close();
            reject(new Error(message.error));
            break;
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket connection closed');
      };
    });
  }

  private async handleAction(action: any) {
    console.log('Executing action:', action.type, action.reasoning);
    this.previousActions.push(action);

    // Execute the action
    if (action.type === 'screenshot') {
      // Capture screenshot and send back
      const screenshot = await this.captureScreenshot();
      this.ws!.send(JSON.stringify({
        type: 'screenshot',
        screenshot
      }));
    } else if (action.type === 'end') {
      // Task ending, no need to send screenshot
      console.log('Task ending:', action.reason);
    } else {
      // Execute action via NutJS interpreter
      await this.executeNutJSAction(action);
      
      // After execution, capture screenshot for next iteration
      const screenshot = await this.captureScreenshot();
      this.ws!.send(JSON.stringify({
        type: 'screenshot',
        screenshot
      }));
    }
  }

  private async handleClarification(questions: any[]) {
    console.log('Clarification needed:', questions);

    // Show UI dialog to user
    const answers = await this.showClarificationDialog(questions);

    // Send answers back
    this.ws!.send(JSON.stringify({
      type: 'clarification_answer',
      answers
    }));
  }

  private async showClarificationDialog(questions: any[]): Promise<Record<string, string>> {
    // Example: Show modal dialog with questions
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'clarification-dialog';
      
      const answers: Record<string, string> = {};

      questions.forEach(q => {
        const questionDiv = document.createElement('div');
        questionDiv.innerHTML = `
          <p>${q.question}</p>
          ${q.options ? `
            <select id="${q.id}">
              ${q.options.map((opt: string) => `<option value="${opt}">${opt}</option>`).join('')}
            </select>
          ` : `
            <input type="text" id="${q.id}" placeholder="Enter answer..." />
          `}
        `;
        dialog.appendChild(questionDiv);
      });

      const submitBtn = document.createElement('button');
      submitBtn.textContent = 'Submit';
      submitBtn.onclick = () => {
        questions.forEach(q => {
          const input = document.getElementById(q.id) as HTMLInputElement | HTMLSelectElement;
          answers[q.id] = input.value;
        });
        document.body.removeChild(dialog);
        resolve(answers);
      };
      dialog.appendChild(submitBtn);

      document.body.appendChild(dialog);
    });
  }

  private async captureScreenshot(): Promise<{ base64: string; mimeType: string }> {
    // Use Electron's desktopCapturer
    const sources = await (window as any).electronAPI.captureScreen();
    return {
      base64: sources[0].thumbnail.toPNG().toString('base64'),
      mimeType: 'image/png'
    };
  }

  private async executeNutJSAction(action: any) {
    // Send to NutJS interpreter via IPC
    await (window as any).electronAPI.executeAction(action);
  }

  cancel() {
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: 'cancel' }));
      this.ws.close();
    }
  }
}

// Usage
const client = new ComputerUseClient();
await client.executeTask('Open Thinkdrop AI project in ChatGPT', {
  activeApp: 'Google Chrome',
  activeUrl: 'https://chatgpt.com'
});
```

---

## Clarification Scenarios

### Scenario 1: Ambiguous Goal

**User:** "Click on it"

**Backend Response:**
```json
{
  "type": "clarification",
  "questions": [
    {
      "id": "target_element",
      "question": "What should I click on?",
      "required": true
    }
  ]
}
```

**User Answer:**
```json
{
  "type": "clarification_answer",
  "answers": {
    "target_element": "The blue Send button in the bottom right"
  }
}
```

### Scenario 2: Multiple Options

**User:** "Open the project"

**Backend Response:**
```json
{
  "type": "clarification",
  "questions": [
    {
      "id": "project_name",
      "question": "Which project should I open?",
      "options": ["Thinkdrop AI", "BibScrip", "Ghost Mouse", "Other"],
      "required": true
    }
  ]
}
```

**User Answer:**
```json
{
  "type": "clarification_answer",
  "answers": {
    "project_name": "Thinkdrop AI"
  }
}
```

### Scenario 3: Mid-Execution Clarification

**Iteration 3:** AI encounters multiple similar buttons

**Backend Response:**
```json
{
  "type": "clarification",
  "questions": [
    {
      "id": "button_choice",
      "question": "I see 3 'Submit' buttons. Which one should I click?",
      "options": ["Top Submit button", "Middle Submit button", "Bottom Submit button"],
      "required": true
    }
  ]
}
```

---

## Server Setup

```typescript
// In your Express app
import { WebSocketServer } from 'ws';
import { handleComputerUseWebSocket } from './api/computerUseWebSocket';

const wss = new WebSocketServer({ noServer: true });

// Upgrade HTTP to WebSocket
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/api/computer-use/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleComputerUseWebSocket(ws, request);
    });
  } else {
    socket.destroy();
  }
});
```

---

## Benefits of WebSocket Approach

✅ **Bidirectional** - Server can request info, client can respond
✅ **Real-time** - No polling, instant communication
✅ **Stateful** - Maintains session state throughout agentic loop
✅ **Efficient** - Single persistent connection vs multiple HTTP requests
✅ **Clarification Support** - Can pause and ask user for input
✅ **Cancellation** - User can cancel mid-execution

---

## Comparison: SSE vs WebSocket

| Feature | SSE (Current) | WebSocket (New) |
|---------|--------------|-----------------|
| **Direction** | Server → Client only | Bidirectional |
| **Clarification** | Awkward (need separate POST) | Natural (send/receive) |
| **State** | Stateless | Stateful session |
| **Cancellation** | Close connection | Send cancel message |
| **Complexity** | Simple | Moderate |
| **Browser Support** | Good | Excellent |

---

## Next Steps

1. ✅ **WebSocket handler created** (`computerUseWebSocket.ts`)
2. ⏳ **Integrate with Express server** (upgrade HTTP to WebSocket)
3. ⏳ **Frontend WebSocket client** (implement in Electron app)
4. ⏳ **UI for clarification dialogs** (modal/overlay component)
5. ⏳ **Test clarification flow** (ambiguous goals, mid-execution questions)

---

## Summary

With WebSocket, clarification questions work seamlessly:

1. **AI detects ambiguity** → Sends `clarification` message
2. **Frontend shows dialog** → User answers questions
3. **Frontend sends answers** → AI resumes with context
4. **Loop continues** → Goal achieved

This makes the Computer Use API much more powerful and user-friendly! 🎯
