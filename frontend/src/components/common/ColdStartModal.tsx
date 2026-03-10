"use client";

import { useState, useEffect } from "react";
import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";

const STORAGE_KEY = "toss_sync_pos_coldstart_seen";

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9999;
  animation: ${fadeIn} 0.2s ease-out;
`;

const Modal = styled.div`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius.lg};
  padding: ${({ theme }) => theme.spacing.xl};
  max-width: 460px;
  width: calc(100% - 32px);
  z-index: 10000;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.16);
  animation: ${slideUp} 0.25s ease-out;
`;

const Icon = styled.div`
  font-size: 36px;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h2`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`;

const Description = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.6;
  margin: 0 0 ${({ theme }) => theme.spacing.lg};
  word-break: keep-all;
`;

const Highlight = styled.span`
  color: ${({ theme }) => theme.colors.primary};
  font-weight: 600;
`;

const ConfirmButton = styled.button`
  width: 100%;
  padding: 14px;
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  border: none;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.primaryHover};
  }
`;

export default function ColdStartModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const seen = sessionStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setVisible(true);
    }
  }, []);

  const handleClose = () => {
    sessionStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <>
      <Overlay onClick={handleClose} />
      <Modal>
        <Icon>☁️</Icon>
        <Title>서버가 준비 중일 수 있어요</Title>
        <Description>
          이 프로젝트의 백엔드는 비용 절감을 위해{" "}
          <Highlight>Render 무료 티어</Highlight>에서 운영되고 있습니다.
          <br />
          <br />
          일정 시간 요청이 없으면 서버가 절전 모드에 들어가며, 첫 접속 시{" "}
          <Highlight>30초~1분 정도</Highlight> 로딩이 걸릴 수 있습니다.
          <br />
          <br />
          잠시 기다리시면 정상적으로 모든 기능을 이용하실 수 있습니다.
        </Description>
        <ConfirmButton onClick={handleClose}>확인</ConfirmButton>
      </Modal>
    </>
  );
}
