# PrivateLLMLens
This provides a Zero-Server Web Interface for use with Ollama local LLM's. Also works on mobile if Ollama has been installed using Termux. Please star the repository if you like it.

Accessible at: https://jimliddle.github.io/privatellmlens/ - Everything stored in your client side browser, or download the html file and run it yourself.

So what is a zero-server web interface ? It is just a HTML file that you can double-click to launch (and then bookmark for subsequent use). It's served as a file through the web browser rather than through http/https.

### Configuration
There is not a lot to configure but you do need to setup the Ollama Origin flag. The Ollama Origins setting is used to whitelist which web origins (domains, protocols, ports) are permitted to access the Ollama server's API. This prevents unauthorized websites from making requests and helps mitigate cross-site request forgery (CSRF) vulnerabilities. In essence, it ensures that only trusted sources (like our local  environment) can interact with your Ollama instance.

#### Mac
On Mac you should enter the following for the command prompt:

<code> launchctl setenv OLLAMA_ORIGINS "*" </code>

After you have done this restart Ollama and verify it is available (http://localhost:11434) and then load the web page
The tell tale that all is well is that models are loaded in the model configuration in the bottom right.
If you want the environment variable to persist across system restarts, you can use a Mac LaunchAgent

#### Windows
On Windows open search and type 'env' and you should see 'edit the system environment variables appear. Click this and the 'System Properties; window will appear. Click the 'Environment Variables' button. 

<code>Create a new User variable called OLLAMA_ORIGINS with a value of * </code> 

The cleanest way for this to stick is to reboot the windows machine. This will now stick between subsequent reboots.

### Overview

This started out as something that would let me test the different models and response times but at some point I realized it would be pretty neat to be able to use this as an easy way to interact with Ollama without ever having to fire up the command prompt. 

Below you can see the interface and you can see that every time we interact with a model the model name and response time are noted:

<img width="916" height="508" alt="Private LLM Lens screenshot" src="https://github.com/user-attachments/assets/b86f1b58-e169-4a9a-9f58-ed425c27ea38" />


This is really useful when you are checking out the capabilities of the different models.

Each of the models can easily be changed from the model dropdown in the bottom right of the screen. This uses the Ollama Tags feature to be able to interrogate and populate the models.

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/b9c591fa-b656-47f2-a76c-b12d893dc15b" />


The last used model will be the auto-selected model next time PrivateLLMLens is refreshed or loaded.

Themes can be switched between light and dark, and the web page will initially follow the desktop theme.

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/0f60e594-df9a-40c7-b08a-ba4a4ed5d08a" />


So if this is a single web page where is the data being persisted I hear you ask. Well, to keep things very simple and to honor the single page paradigm it is taking advantage of the IndexedDB capabilities from the browser. 

IndexedDB is a low-level API built into modern browsers that provides a transactional database system for storing large amounts of structured data on the client side. It lets you store key-value pairs, and can handle complex objects including files and blobs. Because it supports indexing and transactions, you can efficiently retrieve and update your data. IndexedDB is asynchronous, which helps keep your application responsive even when working with large datasets.

In terms of compatibility, IndexedDB is supported by all major modern browsers such as Chrome, Firefox, Safari, Edge, and Opera. This makes it a popular choice for offline storage and caching in web applications.

IndexedDB version one refers to the initial, simpler schema that many early web apps used—typically with a single object store for key-value pairs. IndexedDB version two (as used in rhis code) builds on that by allowing schema migrations through a version number. In this implementation, version 2 enabled me to create multiple object stores (such as separate stores for threads and messages) and add indexes (such as the "threadId" index), making it easier to manage multi-threaded chat data.

In the interface you can see at the bottom a 'Reset IndexedDB' link. In the event IndexedDB every becomes corrupted you can use this. It simply runs some Javascript to delete the IndexedDB in cache and re-constructs it.

Threads enables the user to create different workspaces, for example you could create one for text models and another for vision models:

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/fe234739-7124-42ff-8b42-b8dee537ef37" />


Because Ollama supports vision models we can select a vision model in our workspace and ask it about an image.

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/ad5a4612-8380-40fb-af81-cd7f56b907dc" />


In this case we can see the Lllava-Phi3 image model (the fastest from my testing) took 125 seconds to interrogate the image and respond (I could have no doubt speeded this up substantially by using my external GPU). The image and the response are cached in Indexed DB and will be available in the workspace until you 'clear all messages' or delete the workspace.

From a technical viewpoint we read the image file as a base64 data URL (with the data URL prefix removed), we strip the prefix, and send it to Ollama using the "images" key.

This is a nice way to be able to use and test the various images models locally.

Another things I wanted to be able to do was to at least be able to handle small file attachment inputs. This is something I have implemented for text, pdf, csv, html, python and JSON files.

To demonstrate how this works we gave it a real sample tender document downloaded from the public internet

We attach the PDF file and ask it to:

:Identify the key conditions, omissions, or administrative actions that CERN considers most relevant to the rejection or disqualification of a bid. [Attached: IT-3824_Tender_Form.pdf]:

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/dde910b4-9279-4f24-900c-db80eb9f6f8f" />


The response is a decent summary of the content provided. There is no vector DB or RAG here so technically what we are doing is parsing the text in chunks, summarzing each chunk and pre-appending it to the input prompt. The merged prompt  includes a clear delimiter indicating where the attached content starts and ends. 

I have also implemented a feature, which is being able to leverage the prior output to ask another question. This takes the prior output and inputs it as a 'prior conversation' along with the prompt input and happens automatically if you ask a follow up question in a thread.

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/08520584-5739-41c9-8533-5fd31427dd47" />

The 'dont summarize' feature prevents files being chunked and summarized when being sent to Ollama. This is useful if you are dealing with code files, JSON files, CSV files, or PDF's / Dpc's where you need precise answers in which you don;t want the chunks to be summarized by the LLM.

Below we issue the same tender PDF but this time with 'don't summarize' checked

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/e0ca9653-dc41-43dd-874c-d0acdf6abf85" />

The answer is more comprehensive and for to show the difference I asked it to compare the prior summarized answer with what it provvided and provide an assessment:

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/ce78cdcf-3152-444c-bcd1-01ef1a3cf7d6" />

In the summarization mode (the default) we read each chunk, call the summarization API, and then combine the summaries. In the 'Don’t Summarize' mode we still read the file in chunks (to avoid excedding context), but we skip the API calls and simply concatenate all chunk text into one final raw string.

Chunking helps with memory problems because it prevents PrivateLLMSLens from loading the entire file into context. Instead, we:

(i)   Read and process the file in small slices (chunks).
(ii)  Handle each chunk (either summarizing it or concatenating it) and then move on to the next chunk.
(iii) Never store the entire file’s data in memory simultaneously.

Essentially, each chunk is briefly in memory during its processing, and then it’s discarded. The only data that persists between chunks is the (relatively small) partial result (either a short summary or the incrementally growing concatenated text). This is much more memory-efficient than loading the entire file at once—especially as we are summarizing each chunk into something far smaller.

The chunk size setting can be controlled from the settings section:

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/c252cfec-cb21-4e1a-b358-232a841400ea" />


Note that currently if you set the chunk ssize higer than the context window you’ll get suboptimal or failed results and you should reduce the chunk size. 

Also note from the screenshot above that the Ollama endpoint can be changed in the settings, if your Ollama deployment is not on your local laptop or mobile and you want to use PrivateLLMLens.

The prompt input window can be resized and if you paste in characters above 500 words text will appear as an attachment. If images are pasted into the prompt input windows the will also appear as an attachment but still be visibile in the message history when submitted.

THe following extenal services are supported (API keys need to be entered in the settings):

Perplexity AI Search:

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/d0023618-5208-45a4-9561-7e7d1feaab03" />

Tavily (non AI) Search:

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/cb162d67-a7af-4cea-8c21-8f8667f536ed" />

There is a setting also for enabling the LLM to decide whether it needs to ground its information with a Tavily search. In this sense the LLM is acting more agentic.

OpenAI Image Generation:

<img width="916" height="508" alt="image" src="https://github.com/user-attachments/assets/7f6ccde1-be9b-4bf8-85f4-a4f45b01550a" />










