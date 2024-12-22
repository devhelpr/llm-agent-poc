import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

class Agent {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async callOpenAI(prompt: string, model: string = "gpt-4"): Promise<string> {
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      return (
        response.data.choices[0].message?.content.trim() ||
        "No response received."
      );
    } catch (error) {
      console.error("Error calling OpenAI API:", error);
      return "An error occurred while processing your request.";
    }
  }
}

class Memory {
  private memoryFile: string;

  constructor(memoryFile: string = "memory.json") {
    this.memoryFile = memoryFile;

    // Initialize memory file if it doesn't exist
    if (!fs.existsSync(this.memoryFile)) {
      fs.writeFileSync(this.memoryFile, JSON.stringify([]));
    }
  }

  // Retrieve memory as a JSON array
  getMemory(): Array<{ taskType: string; guidelines: string }> {
    const memoryData = fs.readFileSync(this.memoryFile, "utf-8");
    return JSON.parse(memoryData);
  }

  // Add new learning to memory
  addMemory(taskType: string, guidelines: string): void {
    const memory = this.getMemory();
    memory.push({ taskType, guidelines });
    fs.writeFileSync(this.memoryFile, JSON.stringify(memory, null, 2));
  }

  // Retrieve guidelines relevant to a task type
  getGuidelinesForTask(taskType: string): string {
    const memory = this.getMemory();
    const relevantMemory = memory.filter((m) => m.taskType === taskType);
    return relevantMemory.map((m) => m.guidelines).join("\n") || "";
  }
}

class WorkerAgent extends Agent {
  private memory: Memory;

  constructor(apiKey: string, memory: Memory) {
    super(apiKey);
    this.memory = memory;
  }

  async performTask(task: string, taskType: string): Promise<string> {
    const previousGuidelines = this.memory.getGuidelinesForTask(taskType);

    console.log("Worker Agent: Performing task...");
    return this.callOpenAI(`
      Task: ${task}
      Guidelines from prior learning: ${previousGuidelines}
      Perform the task with the above context.
    `);
  }
}

class EvaluatorAgent extends Agent {
  private memory: Memory;

  constructor(apiKey: string, memory: Memory) {
    super(apiKey);
    this.memory = memory;
  }

  async evaluateOutput(
    task: string,
    output: string,
    taskType: string
  ): Promise<string> {
    console.log("Evaluator Agent: Evaluating output...");
    const feedback = await this.callOpenAI(`
      Task: ${task}	  
      Output: ${output}

      Provide generic/general detailed feedback for ${taskType} (don't mention ANY specifics that are in the Task and/or Output, keep it all GENERAL about ${taskType}) and give general suggestions for improving ${taskType}. All suggestions should be generic and reusable for new tasks like ${taskType}
    `);

    console.log("Evaluator Agent: Updating memory...");
    this.memory.addMemory(taskType, feedback);

    return feedback;
  }
}

class FeedbackLoop {
  private worker: WorkerAgent;
  private evaluator: EvaluatorAgent;

  constructor(worker: WorkerAgent, evaluator: EvaluatorAgent) {
    this.worker = worker;
    this.evaluator = evaluator;
  }

  async runTaskWithFeedback(
    task: string,
    taskType: string,
    iterations: number = 3
  ): Promise<void> {
    let output = await this.worker.performTask(task, taskType);

    for (let i = 1; i <= iterations; i++) {
      console.log(`Iteration ${i}:`);
      console.log("Worker Output:", output);

      const feedback = await this.evaluator.evaluateOutput(
        task,
        output,
        taskType
      );
      console.log("Evaluator Feedback:", feedback);

      output = await this.worker.callOpenAI(
        `Improve the output for the task based on this feedback:\nTask: ${task}\nCurrent Output: ${output}\nFeedback: ${feedback}`
      );
    }

    console.log("Final Improved Output:", output);
    fs.writeFileSync("output.md", output);
  }
}

async function main() {
  const memory = new Memory();

  const worker = new WorkerAgent(OPENAI_API_KEY, memory);
  const evaluator = new EvaluatorAgent(OPENAI_API_KEY, memory);

  const feedbackLoop = new FeedbackLoop(worker, evaluator);

  const task = "Write a short blog post about the benefits of TypeScript.";
  const taskType = "blog_post_writing";

  await feedbackLoop.runTaskWithFeedback(task, taskType);
}

main().catch(console.error);