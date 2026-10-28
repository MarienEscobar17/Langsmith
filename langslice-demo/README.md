# LangSlice workshop demo

A small recreation of the pizza-ordering scenario in [LangSmith explained in 5 minutes](https://www.youtube.com/watch?v=KPcEhLoh-Wc), especially 1:59–3:40. This is original workshop code, not the video's official source repository. The video establishes the large hand-tossed pepperoni-and-pineapple order and zero pineapple stock. The rest of the menu, stock values and test cases are synthetic.

## The demo in one minute

The customer asks for a large hand-tossed pizza with pepperoni and pineapple. `lookup_ingredient` returns `stock_units: 0` for pineapple. The **buggy** `add_pizza` tool still accepts the pizza. The **fixed** tool rejects the whole order and asks for another topping or quantity.

## Run it

Requires Node.js 22 or newer. Open a terminal in this folder.

```powershell
npm install
# Copy .env.example to .env and configure credentials if .env is absent.
npm run demo
```

`demo` creates both traces in the `LangSlice-Demo` project when `LANGSMITH_API_KEY` is configured. Without a key, it works locally. Both versions receive the same inventory snapshot.

```powershell
npm run chat
npm run chat -- --buggy
npm run demo -- --offline
```

The default mode uses a small deterministic order parser and calls real traced tools. It makes **no model calls**. It handles explicit sizes, crusts, named toppings and numeric quantities. It asks for clarification on incomplete orders or negations. Each chat line is a new order. The demo does not charge cards, contact a kitchen, retain a cart, or decrement persistent stock.

For natural-language extraction using an actual LLM:

```powershell
npm run demo -- --live-model
npm run chat -- --live-model
```

This mode needs `OPENAI_API_KEY` and uses `OPENAI_MODEL` from `.env` (default `gpt-4.1-mini`). It adds traced model calls to extract order fields. Inventory enforcement stays in the tool, so the model cannot bypass it. The sample demo makes two model calls with up to 250 output tokens each. Experiments remain deterministic and make no LLM calls.

## Dataset and experiments

```powershell
npm run dataset:upload
npm run evaluate
```

Upload creates **LangSlice-Ingredient-Availability**, containing 16 examples, in the workspace selected by your LangSmith credentials. If a dataset with that name already exists, the script checks its contents. It reuses an exact match and refuses to change a different dataset. To choose another name:

```powershell
npm run dataset:upload -- --dataset LangSlice-Workshop-2
npm run evaluate -- --dataset LangSlice-Workshop-2
```

Open the dataset link printed by the command. In **Datasets & Experiments**, compare the `LangSlice-buggy` and `LangSlice-fixed` experiments. The three score columns are:

- `stock_safety`: any added pizza has sufficient stock for every topping.
- `correct_decision`: accepted, rejected or needs clarification matches the reference.
- `order_match`: the decision, exact pizza and unavailable toppings match the reference.

The sample tests deliberately expose five stock failures. Local expected results: buggy **11/16**, fixed **16/16** for each metric. These scores describe this small synthetic tool regression dataset, not general agent quality.

```powershell
npm run evaluate:local
npm test
```

Local comparison writes `results/local-comparison.json`. Cloud commands write verified dataset and experiment receipts under `results/`.

## Files for import

- `data/langslice-dataset.json`: an array of examples with `inputs`, `outputs` and `metadata`. Suitable for the SDK uploader and LangSmith CLI dataset upload.
- `data/langslice-dataset.jsonl`: one example per line for tools that accept this format.
- `data/langslice-dataset.csv`: readable columns for manual CSV import. Map `request`, `order`, `inventory` to inputs and `status`, `pizza`, `unavailable` to reference outputs. Nested CSV values need JSON parsing. The SDK uploader preserves their object and array types automatically and is the recommended route.

Inputs use `{request, order: {size, crust, toppings, quantity}, inventory}`. Reference outputs use `{status, pizza, unavailable}`. Actual outputs include those fields plus `message` and `inventory_checks`. Each topping consumes one stock unit per pizza. Orders are atomic, duplicate toppings normalize to one topping, and the agent never silently substitutes an ingredient.

## Simple workshop flow

1. Run `npm run demo` and read the two replies.
2. In LangSmith Tracing, open the buggy trace and find the pineapple stock result.
3. Open the fixed trace and show the rejection in `add_pizza`.
4. Open the dataset and inspect `video-pineapple-zero`.
5. Compare the two experiments and inspect the five changed examples.
6. Try `chat` and explain how a production failure can become a dataset case.

## Official references

- [Custom tracing](https://docs.langchain.com/langsmith/annotate-code)
- [Evaluation workflow](https://docs.langchain.com/langsmith/evaluate-llm-application)
- [Dataset management](https://docs.langchain.com/langsmith/manage-datasets)

Keep `.env` private. Share `.env.example` when sharing the project.
