### Core Functionality: 

#### Chat Interface

- ZeroWebServer access to locally installed Ollama and LLM models ie. does not need to be server by a web server. Can be launched by double clicking the file.
- Also works on mobile devices if Ollama has been installed on Termux.
- Provides a text input field for user prompts.
- Displays a chat history with messages from the user and the AI assistant.
- Provides a switchable light and dark theme
- A "Send" button (and Enter key press) triggers sending the message to the Ollama API.
- Handles streaming responses (though the code currently uses stream: false, it's designed with streaming in mind).
- Displays a "Still thinking..." message with a spinner and elapsed time while waiting for a response.
- Shows the model's response time after receiving the complete response.
- Supports follow-on questions by including the previous question and answer in the next prompt if a checkbox is selected.


### File Attachments:

- Allows users to attach  files (text, images, PDFs, Python, HTML, CSV and JSON).
- Previews attachments before sending.
- Handles text files by reading their content and including it in the prompt. This involves chunking the files (size can be conrolled from the settings) and summarizing each chunk.
- Don't summrize checkbox can be checked if the user does not want to use chunking with the file attachments
- Handles image files by converting them to Base64 data URIs and sending them in the images field of the API request. The prompt defaults to text extraction, but the user can override this.
- Handles PDF files by extracting text from all pages using pdf.js and including it in the prompt.
- Santizes the output of files using DOMPurify
- Includes file names in the displayed messages.

### Thread Management:

- Uses IndexedDB to store chat history (messages) and threads. This provides persistence across sessions.
- Allows users to create multiple chat threads.
- Displays a sidebar listing available threads.
- Allows users to switch between threads, loading the corresponding message history.
- Provides buttons to create new threads and delete existing ones.
- Automatically creates a "Default" thread on the first run.
- Highlights the currently active thread in the sidebar.

### Model Selection:

- Fetches a list of available models from the Ollama API (/api/tags).
- Populates a dropdown menu with the available models.
- Saves the user's selected model in localStorage and reloads it on subsequent visits.
- Support Perplexity AI Search for external LLM Searches. API Key required

### Data Storage (IndexedDB):

- Uses IndexedDB for persistent storage (this can be reset).
- Has two object stores:
- messages: Stores individual chat messages. Includes fields for role, text, type (text, image, pdf, txt), fileName, imageData (for images, storing the full data URL), responseTime, and threadId. Has an index on threadId.
- threads: Stores thread information (name, creation timestamp). Has an index on name.
- Includes retry logic for opening the database.
- Includes handling to clear messages and delete threads.

### UI/UX:

- Basic styling. Clear distinction between user and assistant messages.
- Responsive layout (adapts to different screen sizes) with light and dark themes.
- Confirmation dialogs for destructive actions (clearing messages, resetting the database, deleting threads).
- Disables input fields and the send button while waiting for a response.
- Tooltips
- Individual messages can be deleted by clicking the trask icon that appears on hover.
- Used Marked Javascript library to format LLM output

### Settings Screen
- For Perplexity API Key
- For Light/Dark Theme
- To control Chunking settings

### Error Handling:

- Basic error handling for fetching models and loading/saving messages. Displays error messages to the user.
- Retries opening the IndexedDB database on failure.
- Button to reset IndexedDB in the event of corruption
- Enables user to easly clear all messages
- IndexedDB can be reset without going into developer options if required
