import React, { useRef, useState } from 'react';
import { View, Image, Pressable, Platform, Text, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';

import { apiOrigin } from '../api';

export default function CameraScreen() {
    const navigation = useNavigation();
    const uploadInProgress = useRef(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState('');

    const pickPhoto = async (fromCamera) => {
        if (uploadInProgress.current) return;
        setMessage('');

        let origin;
        let photo;
        try {
            origin = apiOrigin('analysis');
            if (fromCamera && Platform.OS !== 'web') {
                const permission = await ImagePicker.requestCameraPermissionsAsync();
                if (!permission.granted) {
                    setMessage('카메라를 사용하려면 권한을 허용해 주세요.');
                    return;
                }
            }

            const options = { mediaTypes: ['images'], allowsEditing: true, quality: 0.9 };
            const result = fromCamera
                ? await ImagePicker.launchCameraAsync(options)
                : await ImagePicker.launchImageLibraryAsync(options);
            if (result.canceled) return;

            photo = result.assets[0];
        } catch {
            setMessage('사진을 열 수 없습니다. 사진 접근 권한과 분석 서버 설정을 확인해 주세요.');
            return;
        }

        if (uploadInProgress.current) return;
        uploadInProgress.current = true;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', photo.file ?? {
                uri: photo.uri,
                name: photo.fileName ?? 'photo.jpg',
                type: photo.mimeType ?? 'image/jpeg',
            });
            const response = await fetch(`${origin}/upload`, {
                method: 'POST',
                body: formData,
                redirect: 'error',
            });

            if (!response.ok) {
                setMessage(response.status === 413
                    ? '사진이 너무 큽니다. 용량을 줄여 다시 올려 주세요.'
                    : '사진을 분석하지 못했습니다. 다른 사진을 선택하거나 잠시 후 다시 시도해 주세요.');
                return;
            }
            const { detected_ingredients: detectedIngredients } = await response.json();
            if (!Array.isArray(detectedIngredients) || detectedIngredients.some(item => typeof item !== 'string')) {
                throw new Error('Invalid analysis response');
            }
            navigation.navigate('AiResultScreen', { detectedIngredients });
        } catch {
            setMessage('사진을 전송하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
        } finally {
            uploadInProgress.current = false;
            setUploading(false);
        }
    };

    return (
        <View style={styles.container}>
            <Image
                source={require('../../assets/Icon/add_a_photo_24dp_CECECE_FILL0_wght400_GRAD0_opsz24.png')}
                style={styles.cameraImage}
            />
            <Pressable accessibilityRole="button" disabled={uploading} onPress={() => pickPhoto(true)} style={styles.button}>
                <Text style={styles.buttonText}>카메라 열기</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={uploading} onPress={() => pickPhoto(false)} style={styles.button}>
                <Text style={styles.buttonText}>사진 선택</Text>
            </Pressable>
            {(uploading || !!message) && (
                <Text accessibilityLiveRegion="polite" style={styles.message}>
                    {uploading ? '사진을 분석하고 있습니다.' : message}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    cameraImage: {
        width: 100,
        height: 100,
        tintColor: '#555', // 아이콘 색상 조정 (필요 시 제거 가능)
    },
    button: {
        marginTop: 12,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: '#555',
        borderRadius: 8,
    },
    buttonText: {
        color: '#222',
        fontSize: 16,
    },
    message: {
        margin: 16,
        textAlign: 'center',
    },
});
