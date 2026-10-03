package androperator.speechtotext

import action.log.Log
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

class SpeechRecognizerAndroid(
    context: Context,
) {
    private val speechRecognizer: SpeechRecognizer = SpeechRecognizer.createSpeechRecognizer(context)
    private val recognizerIntent: Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 3000)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 3000)
            }

    init {
        speechRecognizer.setRecognitionListener(
            object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    Log.d("$TAG Ready for speech")
                }

                override fun onBeginningOfSpeech() {
                    Log.d("$TAG Speech started")
                }

                override fun onRmsChanged(rmsdB: Float) {
                    // Optional: Log RMS values if needed
                }

                override fun onBufferReceived(buffer: ByteArray?) {
                    Log.d("$TAG Buffer received")
                }

                override fun onEndOfSpeech() {
                    Log.d("$TAG Speech ended")
                }

                override fun onError(error: Int) {
                    Log.d("$TAG Error occurred: $error")
                }

                override fun onResults(results: Bundle?) {
                    val data = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    data?.forEach { result ->
                        Log.d("$TAG Final result: $result")
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    val data = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    data?.forEach { partial ->
                        Log.d("$TAG Partial result: $partial")
                    }
                }

                override fun onEvent(
                    eventType: Int,
                    params: Bundle?,
                ) {
                    Log.d("$TAG Event occurred: $eventType")
                }
            },
        )
    }

    fun startListening() {
        Log.d("$TAG Starting listening...")
        speechRecognizer.startListening(recognizerIntent)
    }

    fun stopListening() {
        Log.d("$TAG Stopping listening...")
        speechRecognizer.stopListening()
    }

    fun destroy() {
        Log.d("$TAG Destroying SpeechRecognizer")
        speechRecognizer.destroy()
    }

    companion object {
        private const val TAG = "SpeechRecognizer"
    }
}
