# Frontassess
# FrontStellar Assess

**A multi-provider, multi-model AI benchmarking dashboard for inference speed, latency, and response comparison.**
<img width="2048" height="768" alt="image" src="https://github.com/user-attachments/assets/f0849802-b4de-4a3f-aadc-8ffb60c45afa" />

FrontStellar Assess is a web-based tool designed to test and compare language models across multiple API providers through a unified interface. It allows users to run the same prompt against selected models, inspect performance metrics, compare generated responses, visualize results, and export benchmark data.

The goal is to make AI model evaluation more practical by providing a consistent interface for measuring inference performance and examining model outputs.

## Features

### Multi-Provider Support

Connect API-compatible providers using a configurable Base URL and API key.

Available presets include:

- OpenAI
- OpenRouter
- Groq
- DeepSeek
- Together AI
- Mistral
- xAI (Grok)
- Cerebras
- Fireworks AI
- Google Gemini (OpenAI-compatible endpoint)
- Ollama
- LM Studio

Custom API endpoints can also be configured.

> Provider compatibility depends on the endpoint implementation, supported API features, model availability, and server configuration.

### Model Selection and Prompt Testing

- Retrieve available models from connected providers.
- Select individual models or multiple models for comparison.
- Send a shared prompt to selected models.
- Configure an optional system prompt.
- Adjust temperature and maximum output tokens.
- Use built-in prompt presets or write custom prompts.

### Flexible Execution Modes

- **Parallel execution:** Run multiple model tests concurrently.
- **Sequential execution:** Run model tests one after another.
- Configure concurrency limits.
- Set delays between sequential requests.
- Repeat tests per model.
- Configure retries for HTTP 429 rate-limit responses.
- Cancel an active benchmark.

Parallel execution can reduce overall testing time, but provider rate limits and network conditions may affect results.

### Performance Metrics

| Metric | Description |
|---|---|
| TTFT | Time to First Token: time until the first response token is received. |
| TPS | Tokens Per Second: output generation speed after the first token. |
| Total | Provider-side generation duration, as represented by the application. |
| E2E | End-to-end latency measured in the browser, including retry waiting time. |
| Output Tokens | Number of generated tokens, potentially estimated when provider usage data is unavailable. |
| Characters | Length of the generated response in characters. |
| Status | Result or failure status for each model test. |

Metric definitions and calculation details should be verified against the implementation before using benchmark results for rigorous performance comparisons.

### Results and Visualization

- Model performance rankings.
- Response-duration timeline.
- Generation-speed comparison.
- TTFT versus TPS scatter plot.
- Sortable benchmark results table.
- Side-by-side or list-based response comparison.
- Test history.
- Export results as CSV, JSON, or Markdown.

## Getting Started

### Requirements

The visible frontend references the following files:

- `index.html`
- `styles.css`
- `app.js`
- `charts.js`

The application also expects a compatible local server or backend for API requests. Its implementation, dependencies, and exact runtime requirements must be confirmed from the corresponding source files.

### Installation

1. Clone the repository:

   ```bash
   git clone <YOUR_REPOSITORY_URL>
   cd <YOUR_REPOSITORY_DIRECTORY>
   ```

2. Ensure that all required frontend assets and backend files are present.

3. Start the application using the server command defined by the project.

4. Open the application in your browser at the local address provided by the server.

**Note:** Opening `index.html` directly may not be sufficient if the application depends on backend API routes or server-side request handling.

### Basic Usage

1. Select a provider preset or enter a custom API Base URL.
2. Enter the corresponding API key.
3. Test the connection and load the available models.
4. Select the models you want to compare.
5. Enter a shared prompt or choose a prompt preset.
6. Optionally configure the system prompt, temperature, maximum tokens, concurrency, repetitions, and retry behavior.
7. Choose parallel or sequential execution.
8. Run the benchmark.
9. Inspect the metrics, rankings, visualizations, and generated responses.
10. Export the results for further analysis.

## Benchmarking Recommendations

For more meaningful comparisons:

- Use identical prompts and comparable generation settings.
- Record the provider, model identifier, endpoint, and test configuration.
- Run multiple repetitions rather than relying on a single request.
- Compare parallel and sequential tests separately.
- Account for rate limits, retries, failures, network latency, and provider-side queueing.
- Distinguish actual provider-reported token usage from estimated token counts.
- Compare response quality separately from inference speed.
- Record test conditions when comparing results across different sessions.

A faster response does not necessarily indicate a more capable model. The best model depends on the intended workload, output quality, reliability, latency, and cost.

## Security and Privacy

API keys are sensitive credentials. Before deploying this application publicly or using production credentials:

- Review how API keys are transmitted, stored, and deleted.
- Verify that the backend does not expose credentials through responses or logs.
- Avoid committing API keys, `.env` files, or other secrets to version control.
- Restrict access to any backend that can forward requests using user-supplied credentials.
- Validate provider URLs and implement appropriate request controls to prevent unauthorized server-side requests.
- Review browser storage and clear credentials when they are no longer needed.

The frontend indicates that provider configurations are stored in browser `localStorage` and that API keys are sent to a local server for forwarding. The complete security properties depend on the backend and JavaScript implementation.

## Limitations

- Benchmark results depend on network conditions, provider infrastructure, model availability, rate limits, and API behavior.
- Providers may differ in streaming support, token usage reporting, and supported request parameters.
- Parallel execution can influence latency and failure rates.
- Token counts may be estimates when usage information is unavailable.
- Performance rankings alone do not establish response quality, reasoning ability, or tool-calling reliability.
- AI agent workloads require additional tests for tool selection, argument validity, task completion, and multi-step execution.

## Roadmap

Potential future improvements include:

- Statistical summaries such as median, p95 latency, and run-to-run variability.
- More detailed error classification and retry reporting.
- Reproducible benchmark configurations.
- Cost-per-request and cost-per-token comparisons.
- Structured tool-calling benchmarks for AI agents.
- Long-context evaluation.
- Reliability and task-completion scoring.
- Improved API-key handling and deployment security.

These are potential enhancements, not claims about currently implemented functionality.

## Contributing

Contributions, bug reports, and suggestions are welcome.

When reporting a benchmark issue, include the provider, model identifier, execution mode, test configuration, and relevant error details. Never include API keys or other sensitive credentials.

## License

No license has been specified yet. Add a `LICENSE` file before distributing the project under an open-source license.

---

**FrontStellar Assess** — Measure inference performance. Compare model responses. Make data-informed AI model choices.
